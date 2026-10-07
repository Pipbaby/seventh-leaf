package io.github.pipbaby.seventhleaf;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Folder mode on Android (see src/folder-android.js). Folders are chosen with the system picker
 * (Storage Access Framework) and kept with a persistable read permission, so the app needs no
 * broad photo, video or audio permission. Each folder gets a short id made from the slot it is in
 * (pictures or music) and its tree URI, so choosing the same folder again finds its index and
 * thumbnails again, and the same folder can be in both slots.
 */
@CapacitorPlugin(name = "SeventhLeafFolders")
public class FoldersPlugin extends Plugin {

    private static final String PREFS = "folders";
    private static final String[] COLUMNS = {
        Document.COLUMN_DOCUMENT_ID,
        Document.COLUMN_DISPLAY_NAME,
        Document.COLUMN_MIME_TYPE,
        Document.COLUMN_SIZE,
        Document.COLUMN_LAST_MODIFIED
    };
    private static final int CHUNK = 400;

    // walks run here, not on Capacitor's plugin thread, which the other plugins share
    private final ExecutorService walker = Executors.newSingleThreadExecutor();
    // the walk running for each folder: set to stop it
    private final Map<String, AtomicBoolean> walks = new ConcurrentHashMap<>();

    @Override
    public void load() {
        // the WebView asks FileServer for /_sl/... before Capacitor's own local server
        getBridge().setWebViewClient(new FileServer(getBridge(), this));
    }

    // ── choosing ──────────────────────────────────────────────────────────────────────────

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        // open where the folder probably is: the one chosen before, the camera folder or Music
        Uri tree = treeOf(call.getString("id", ""));
        Uri start = tree != null
            ? DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree))
            : DocumentsContract.buildDocumentUri(
                  "com.android.externalstorage.documents",
                  "music".equals(call.getString("slot")) ? "primary:Music" : "primary:DCIM"
              );
        intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, start);
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (tree == null) {
            call.reject("No folder was chosen", "cancelled");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Cannot keep access to this folder", "denied", e);
            return;
        }
        String id = idOf(call.getString("slot", "") + "|" + tree);
        prefs().edit().putString(id, tree.toString()).apply();
        JSObject out = new JSObject();
        out.put("id", id);
        out.put("name", nameOf(tree));
        call.resolve(out);
    }

    // which saved folders can still be read: { states: { id: "ready" | "denied" | "missing" } }
    @PluginMethod
    public void granted(PluginCall call) {
        JSObject states = new JSObject();
        try {
            for (String id : call.getArray("ids", new JSArray()).<String>toList()) states.put(id, stateOf(id));
        } catch (Exception e) {
            call.reject("Bad ids", e);
            return;
        }
        JSObject out = new JSObject();
        out.put("states", states);
        call.resolve(out);
    }

    // stop keeping access to a folder the user removed
    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id", "");
        Uri tree = treeOf(id);
        prefs().edit().remove(id).apply();
        // the other slot may have the same folder: it keeps access then
        if (tree != null && !prefs().getAll().containsValue(tree.toString())) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException ignored) {
                // it had gone already
            }
        }
        FileServer.forget(id);
        call.resolve();
    }

    // ── listing ───────────────────────────────────────────────────────────────────────────

    /**
     * Walks a folder and its subfolders and calls back with the files, a few hundred at a time:
     * { files: [{ path, size, mtime, type }], done }. Hidden files and folders are skipped, as on
     * the desktop. Errors: "denied" (permission revoked) or "missing" (moved or deleted).
     */
    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void list(PluginCall call) {
        String id = call.getString("id", "");
        Uri tree = treeOf(id);
        if (tree == null) {
            call.reject("Unknown folder", "denied");
            return;
        }
        call.setKeepAlive(true);
        // a new walk of a folder stops the one before
        AtomicBoolean stop = new AtomicBoolean();
        AtomicBoolean before = walks.put(id, stop);
        if (before != null) before.set(true);
        walker.execute(() -> {
            walk(call, id, tree, stop);
            walks.remove(id, stop);
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        AtomicBoolean stop = walks.get(call.getString("id", ""));
        if (stop != null) stop.set(true);
        call.resolve();
    }

    private void walk(PluginCall call, String id, Uri tree, AtomicBoolean stop) {
        ContentResolver resolver = getContext().getContentResolver();
        Map<String, String> paths = FileServer.paths(id);
        ArrayDeque<String[]> dirs = new ArrayDeque<>(); // { document id, path prefix }
        dirs.push(new String[] { DocumentsContract.getTreeDocumentId(tree), "" });
        JSArray files = new JSArray();
        try {
            while (!dirs.isEmpty() && !stop.get()) {
                String[] dir = dirs.pop();
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, dir[0]);
                try (Cursor c = resolver.query(children, COLUMNS, null, null, null)) {
                    if (c == null) throw new FileNotFoundException(dir[1]);
                    while (c.moveToNext() && !stop.get()) {
                        String name = c.getString(1);
                        if (name == null || name.startsWith(".")) continue;
                        String path = dir[1] + name;
                        if (Document.MIME_TYPE_DIR.equals(c.getString(2))) {
                            dirs.push(new String[] { c.getString(0), path + "/" });
                            continue;
                        }
                        paths.put(path, c.getString(0));
                        JSObject f = new JSObject();
                        f.put("path", path);
                        f.put("size", c.isNull(3) ? -1 : c.getLong(3));
                        f.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
                        f.put("type", c.getString(2));
                        files.put(f);
                        if (files.length() >= CHUNK) {
                            send(call, files, false);
                            files = new JSArray();
                        }
                    }
                }
            }
            call.setKeepAlive(false);
            send(call, files, true);
        } catch (SecurityException e) {
            fail(call, "denied", e);
        } catch (Exception e) {
            fail(call, stateOf(id).equals("denied") ? "denied" : "missing", e);
        }
    }

    private void send(PluginCall call, JSArray files, boolean done) {
        JSObject out = new JSObject();
        out.put("files", files);
        out.put("done", done);
        call.resolve(out);
        if (done) getBridge().releaseCall(call);
    }

    private void fail(PluginCall call, String code, Exception e) {
        call.setKeepAlive(false);
        call.reject(e.toString(), code);
        getBridge().releaseCall(call);
    }

    // ── saved folders ─────────────────────────────────────────────────────────────────────

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    Uri treeOf(String id) {
        String s = prefs().getString(id, null);
        return s == null ? null : Uri.parse(s);
    }

    private String stateOf(String id) {
        Uri tree = treeOf(id);
        if (tree == null) return "denied";
        boolean kept = false;
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isReadPermission()) kept = true;
        }
        if (!kept) return "denied";
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContext().getContentResolver().query(root, new String[] { Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            return c != null && c.moveToFirst() ? "ready" : "missing";
        } catch (SecurityException e) {
            return "denied";
        } catch (Exception e) {
            return "missing";
        }
    }

    private String nameOf(Uri tree) {
        Uri root = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        try (Cursor c = getContext().getContentResolver().query(root, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
        } catch (Exception ignored) {
            // fall back to the end of its path
        }
        String doc = DocumentsContract.getTreeDocumentId(tree);
        return doc.substring(Math.max(doc.lastIndexOf('/'), doc.lastIndexOf(':')) + 1);
    }

    // 12 hex digits of the slot and tree URI's SHA-256: short, safe in a URL path, and stable
    private static String idOf(String key) {
        try {
            byte[] h = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder s = new StringBuilder();
            for (int i = 0; i < 6; i++) s.append(String.format("%02x", h[i]));
            return s.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
