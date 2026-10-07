package io.github.pipbaby.seventhleaf;

import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.io.FileInputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Serves the files of the chosen folders to the WebView at https://localhost/_sl/<id>/<path>,
 * streamed from the content URI: nothing is copied, and nothing goes through the plugin bridge.
 * Range requests are answered, so videos can seek and a picture's header can be read alone.
 * Everything else goes to Capacitor's own local server, as before.
 */
class FileServer extends BridgeWebViewClient {

    private static final String PREFIX = "/_sl/";
    // document ids by path, per folder: filled while listing, looked up when a file is asked for
    private static final Map<String, Map<String, String>> PATHS = new ConcurrentHashMap<>();

    private final Bridge bridge;
    private final FoldersPlugin folders;

    FileServer(Bridge bridge, FoldersPlugin folders) {
        super(bridge);
        this.bridge = bridge;
        this.folders = folders;
    }

    static Map<String, String> paths(String id) {
        return PATHS.computeIfAbsent(id, k -> new ConcurrentHashMap<>());
    }

    static void forget(String id) {
        PATHS.remove(id);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String path = url.getPath();
        if (path == null || !path.startsWith(PREFIX) || !bridge.getHost().equals(url.getHost())) {
            return super.shouldInterceptRequest(view, request);
        }
        // getPathSegments() decodes each segment: a file name may hold any character but '/'
        List<String> parts = url.getPathSegments();
        if (parts.size() < 3) return status(404, "Not Found");
        String id = parts.get(1);
        String rel = String.join("/", parts.subList(2, parts.size()));
        try {
            return serve(id, rel, request.getRequestHeaders());
        } catch (SecurityException e) {
            return status(403, "Forbidden");
        } catch (Exception e) {
            return status(404, "Not Found");
        }
    }

    private WebResourceResponse serve(String id, String rel, Map<String, String> headers) throws IOException {
        Uri tree = folders.treeOf(id);
        if (tree == null) return status(404, "Not Found");
        String doc = documentOf(tree, id, rel);
        if (doc == null) return status(404, "Not Found");
        Uri uri = DocumentsContract.buildDocumentUriUsingTree(tree, doc);
        ParcelFileDescriptor fd = bridge.getContext().getContentResolver().openFileDescriptor(uri, "r");
        if (fd == null) return status(404, "Not Found");
        long size = fd.getStatSize();
        FileInputStream in = new ParcelFileDescriptor.AutoCloseInputStream(fd);

        Map<String, String> out = new HashMap<>();
        out.put("Accept-Ranges", "bytes");
        out.put("Cache-Control", "no-store");
        String mime = mimeOf(rel);

        String range = header(headers, "Range");
        if (range == null || size < 0 || !range.startsWith("bytes=") || range.contains(",")) {
            if (size >= 0) out.put("Content-Length", String.valueOf(size));
            return new WebResourceResponse(mime, null, 200, "OK", out, in);
        }
        // bytes=a-b, bytes=a- or bytes=-n (the last n bytes)
        String[] ab = range.substring(6).trim().split("-", -1);
        long from;
        long to;
        try {
            if (ab[0].isEmpty()) {
                from = Math.max(0, size - Long.parseLong(ab[1]));
                to = size - 1;
            } else {
                from = Long.parseLong(ab[0]);
                to = ab.length > 1 && !ab[1].isEmpty() ? Math.min(Long.parseLong(ab[1]), size - 1) : size - 1;
            }
        } catch (NumberFormatException e) {
            from = 0;
            to = -1;
        }
        if (from > to || from >= size) {
            in.close();
            out.put("Content-Range", "bytes */" + size);
            return new WebResourceResponse(mime, null, 416, "Range Not Satisfiable", out, new ByteArrayInputStream(new byte[0]));
        }
        in.getChannel().position(from);
        long length = to - from + 1;
        out.put("Content-Range", "bytes " + from + "-" + to + "/" + size);
        out.put("Content-Length", String.valueOf(length));
        return new WebResourceResponse(mime, null, 206, "Partial Content", out, new Limited(in, length));
    }

    // a file's document id: from the last listing, or found folder by folder after a restart
    private String documentOf(Uri tree, String id, String rel) {
        Map<String, String> known = paths(id);
        String doc = known.get(rel);
        if (doc != null) return doc;
        doc = DocumentsContract.getTreeDocumentId(tree);
        for (String name : rel.split("/")) {
            doc = childOf(tree, doc, name);
            if (doc == null) return null;
        }
        known.put(rel, doc);
        return doc;
    }

    private String childOf(Uri tree, String parent, String name) {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parent);
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME };
        try (Cursor c = bridge.getContext().getContentResolver().query(children, columns, null, null, null)) {
            while (c != null && c.moveToNext()) if (name.equals(c.getString(1))) return c.getString(0);
        }
        return null;
    }

    private static String mimeOf(String path) {
        String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        if (ext.equals("mov")) return "video/mp4"; // the WebView plays a phone's MOV files, but not as video/quicktime
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    private static String header(Map<String, String> headers, String name) {
        for (Map.Entry<String, String> h : headers.entrySet()) if (h.getKey().equalsIgnoreCase(name)) return h.getValue();
        return null;
    }

    private static WebResourceResponse status(int code, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", code, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    // a stream that ends after `left` bytes: the end of a range
    private static class Limited extends FilterInputStream {

        private long left;

        Limited(InputStream in, long length) {
            super(in);
            left = length;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = super.read();
            if (b >= 0) left--;
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = super.read(buf, off, (int) Math.min(len, left));
            if (n > 0) left -= n;
            return n;
        }

        @Override
        public long skip(long n) throws IOException {
            long s = super.skip(Math.min(n, left));
            left -= s;
            return s;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }
    }
}
