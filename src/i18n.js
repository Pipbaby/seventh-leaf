// Interface languages. Elements carry data-i18n (text), data-i18n-title (tooltip) or
// data-i18n-placeholder keys; code asks t(key, {vars}).
export const LANGS = { en: 'EN', zh: 'CN', ja: 'JP' };
const HTML_LANG = { en: 'en', zh: 'zh-CN', ja: 'ja' };

const T = {
  'start.desc': [
    'A wall of 12 × 7 split-flap cells. Every change, each cell flips seven times through other artwork before the new image settles.',
    '由 12 × 7 个翻页单元组成的墙面。每次换图时，每个单元都会先翻过其他作品的片段七次，新的画面才会定格。',
    '12 × 7 のフラップ式セルでできた壁。画像が切り替わるたび、各セルはほかの作品の断片を7回めくってから、新しい画像に落ち着きます。',
  ],
  'start.go': ['Start', '开始', 'スタート'],
  'start.help': [
    'Sound starts with this click. Drag to look around · click a cell to flip it · Shift-click for a ripple · H hides the controls',
    '点击后开始播放声音。拖动可环视 · 点击单元可单独翻页 · Shift+点击产生波纹 · 按 H 隐藏控制面板',
    'このクリックで音が始まります。ドラッグで見回す · セルをクリックでめくる · Shift+クリックで波紋 · H でコントロールを隠す',
  ],
  'bar.prev': ['Previous (←)', '上一张 (←)', '前へ (←)'],
  'bar.next': ['Next (→)', '下一张 (→)', '次へ (→)'],
  'bar.controls': ['Controls', '控制面板', 'コントロール'],
  'bar.pause': ['Pause the slideshow (Space)', '暂停轮播（空格）', 'スライドショーを一時停止（Space）'],
  'bar.play': ['Play the slideshow (Space)', '播放轮播（空格）', 'スライドショーを再生（Space）'],
  'bar.lang': ['Language', '语言', '言語'],
  'tab.wall': ['Wall', '墙面', '壁'],
  'tab.lib': ['Library', '素材库', 'ライブラリ'],
  'tab.sound': ['Sound', '声音', 'サウンド'],

  'wall.pattern': ['Wave pattern', '波形', '波のパターン'],
  'wall.flips': ['Flips per cell', '每格翻页次数', 'セルごとのめくり回数'],
  'wall.interval': ['Time between flips', '翻页间隔', 'めくりの間隔'],
  'wall.span': ['Wave crossing time', '波传过墙面的时间', '波が壁を横切る時間'],
  'wall.order': ['In-between leaves', '中途翻过的页面', '途中でめくれる面'],
  'wall.order.random': ['Random artwork per cell', '每格随机作品', 'セルごとにランダムな作品'],
  'wall.order.deck': ['Library order (one drum)', '按素材库顺序（同一卷轴）', 'ライブラリ順（ひとつのドラム）'],
  'wall.clock': ['Shared mechanical clock', '共用机械节拍', '共通の機械クロック'],
  'wall.triptych': ['Three-portrait layout', '三联竖图排版', '縦長3枚並べ'],
  'wall.triptych.hint': [
    'Shows portrait images three at a time, side by side, so they fill the wall.',
    '竖幅图片每三张并排显示，铺满整面墙。',
    '縦長の画像を3枚ずつ横に並べ、壁いっぱいに表示します。',
  ],
  'wall.hold': ['Hold each image', '每张停留时间', '1枚の表示時間'],
  'wall.shuffle': ['Shuffle', '随机顺序', 'シャッフル'],
  'wall.waitVideo': ['Let videos play to the end', '视频播放完再切换', '動画は最後まで再生'],
  'wall.mode': ['Leaves', '页面', '面'],
  'wall.mode.printed': ['Printed artwork (like the exhibition)', '印刷作品（同展览）', '印刷された作品（展示と同じ）'],
  'wall.mode.projected': ['Black leaves + projector', '黑色页面 + 投影', '黒い面 + プロジェクター'],
  'wall.details': ['Show axle rings and leaf stops', '显示轴环和页面挡块', '軸のリングと面のストッパーを表示'],
  'wall.view': ['View', '视角', '視点'],
  'wall.view.front': ['Front', '正面', '正面'],
  'wall.view.angled': ['From the side', '侧面', '斜めから'],
  'wall.keys': [
    'Keys: ← → change · Space play/pause · 1–7 patterns · M music · F fullscreen · H hide controls',
    '快捷键：← → 切换 · 空格 播放/暂停 · 1–7 波形 · M 音乐 · F 全屏 · H 隐藏控制',
    'キー：← → 切替 · Space 再生/停止 · 1–7 パターン · M 音楽 · F 全画面 · H コントロールを隠す',
  ],

  'pattern.diagonal-filmed': ['Diagonal ↙ from top right (as filmed)', '从右上向左下的对角线（同实拍）', '右上から左下への斜め（撮影どおり）'],
  'pattern.sweep-left': ['Sweep ←', '向左扫过 ←', '左へ ←'],
  'pattern.sweep-right': ['Sweep →', '向右扫过 →', '右へ →'],
  'pattern.top-down': ['Top to bottom', '从上到下', '上から下へ'],
  'pattern.diagonal': ['Diagonal', '对角线', '斜め'],
  'pattern.radial': ['Ripple from a point', '从一点扩散', '一点から波紋'],
  'pattern.random': ['Rain (random)', '雨点（随机）', '雨（ランダム）'],
  'pattern.together': ['All at once', '同时翻转', '一斉に'],

  'lib.import': ['+ Import images / videos', '+ 导入图片 / 视频', '+ 画像・動画を読み込む'],
  'lib.hint': [
    'Or drop files anywhere. Click a thumbnail to show it; drag to reorder.',
    '也可以把文件拖到页面任意位置。点击缩略图即可显示，拖动可调整顺序。',
    'ファイルはどこにドロップしても読み込めます。サムネイルをクリックで表示、ドラッグで並べ替え。',
  ],
  'lib.set': ['Shown in a three-portrait set. Adjust its crop below.', '此图显示在三联竖图中，可在下方调整裁切。', '縦長3枚セットの一部として表示中。下で切り抜きを調整できます。'],
  'lib.fit': ['Fit to wall', '适配墙面', '壁へのはめ方'],
  'lib.fit.auto': ['Auto', '自动', '自動'],
  'lib.fit.cover': ['Fill (crop)', '填满（裁切）', '全面（切り抜き）'],
  'lib.fit.contain': ['Whole image (blurred surround)', '完整显示（模糊背景）', '全体表示（ぼかし背景）'],
  'lib.fx': ['Horizontal focus', '水平焦点', '横の中心'],
  'lib.fy': ['Vertical focus', '垂直焦点', '縦の中心'],
  'lib.zoom': ['Zoom', '缩放', 'ズーム'],
  'lib.loop': ['Loop', '循环', 'ループ'],
  'lib.mute': ['Mute this video', '此视频静音', 'この動画をミュート'],
  'lib.delete': ['Delete', '删除', '削除'],
  'lib.empty': ['No images yet — import some', '还没有图片——请先导入', 'まだ画像がありません — 読み込んでください'],
  'lib.confirmDelete': ['Delete “{name}” from the wall?', '要从墙面删除“{name}”吗？', '「{name}」を壁から削除しますか？'],
  'lib.confirmLocal': [
    '(It is a folder image: it will be hidden, not erased.)',
    '（这是文件夹中的图片：只会隐藏，不会删除文件。）',
    '（フォルダの画像なので、非表示になるだけで削除はされません。）',
  ],
  'lib.restore': ['Restore {n} hidden folder image(s)', '恢复 {n} 张已隐藏的文件夹图片', '非表示にしたフォルダ画像 {n} 枚を戻す'],
  'lib.importing': ['Importing {n} file(s)…', '正在导入 {n} 个文件…', '{n} 個のファイルを読み込み中…'],
  'lib.imported': ['Imported.', '导入完成。', '読み込みました。'],
  'lib.mode.import': ['Imported', '已导入', '読み込んだもの'],
  'lib.mode.folder': ['Folder', '文件夹', 'フォルダ'],
  'lib.search': ['Search by name', '按名称搜索', '名前で検索'],
  'lib.count': ['{n} items', '{n} 项', '{n} 件'],
  'lib.found': ['{n} of {total}', '{n} / {total} 项', '{total} 件中 {n} 件'],
  'lib.close': ['Close', '关闭', '閉じる'],

  'folder.intro.pictures': [
    'Show pictures and videos straight from a folder on this computer, subfolders included. Nothing is copied or uploaded: the browser keeps only a small index with thumbnails.',
    '直接显示本机某个文件夹（含子文件夹）中的图片和视频。不会复制或上传任何文件：浏览器只保存一份带缩略图的小索引。',
    'このコンピュータのフォルダ（サブフォルダを含む）の画像や動画をそのまま表示します。ファイルのコピーやアップロードは行わず、ブラウザにはサムネイル付きの小さな索引だけを保存します。',
  ],
  'folder.intro.music': [
    'Play music straight from a folder on this computer, subfolders included. Nothing is copied or uploaded.',
    '直接播放本机某个文件夹（含子文件夹）中的音乐。不会复制或上传任何文件。',
    'このコンピュータのフォルダ（サブフォルダを含む）の音楽をそのまま再生します。ファイルのコピーやアップロードは行いません。',
  ],
  'folder.choose': ['Choose folder…', '选择文件夹…', 'フォルダを選ぶ…'],
  'folder.change': ['Choose another folder…', '选择其他文件夹…', '別のフォルダを選ぶ…'],
  'folder.chooseAgain': ['Choose again', '重新选择', '選び直す'],
  'folder.reconnect': ['Reconnect folder', '重新连接文件夹', 'フォルダに再接続'],
  'folder.rescan': ['Rescan', '重新扫描', '再スキャン'],
  'folder.cancel': ['Cancel', '取消', 'キャンセル'],
  'folder.forget': ['Forget this folder', '移除此文件夹', 'このフォルダを外す'],
  'folder.confirmForget': [
    'Forget the folder “{name}”? Its index and thumbnails are removed from this browser. The files in the folder are not touched.',
    '要移除文件夹“{name}”吗？它的索引和缩略图将从此浏览器中删除，文件夹中的文件不受影响。',
    'フォルダ「{name}」を外しますか？索引とサムネイルはこのブラウザから削除されます。フォルダ内のファイルには影響しません。',
  ],
  'folder.scanning': ['Scanning… {n} files', '正在扫描… {n} 个文件', 'スキャン中… {n} ファイル'],
  'folder.thumbs': ['Thumbnails: {done} / {total}', '缩略图：{done} / {total}', 'サムネイル：{done} / {total}'],
  'folder.bad': ['{n} files could not be read', '{n} 个文件无法读取', '{n} 個のファイルを読み込めませんでした'],
  'folder.empty.pictures': ['No pictures or videos were found in this folder.', '此文件夹中没有找到图片或视频。', 'このフォルダには画像も動画も見つかりませんでした。'],
  'folder.empty.music': ['No music was found in this folder.', '此文件夹中没有找到音乐。', 'このフォルダには音楽が見つかりませんでした。'],
  'folder.reconnectHint': [
    'The browser needs your permission again to read “{name}”.',
    '浏览器需要再次获得你的许可才能读取“{name}”。',
    '「{name}」を読み込むには、もう一度ブラウザに許可を与える必要があります。',
  ],
  'folder.again': [
    'This browser cannot remember folders. Choose “{name}” again to show it.',
    '此浏览器无法记住文件夹。请重新选择“{name}”以显示它。',
    'このブラウザはフォルダを記憶できません。表示するには「{name}」を選び直してください。',
  ],
  'folder.missing': [
    'The folder “{name}” could not be found. It may have been moved, renamed or deleted.',
    '找不到文件夹“{name}”。它可能已被移动、重命名或删除。',
    'フォルダ「{name}」が見つかりません。移動、名前の変更、または削除された可能性があります。',
  ],
  'folder.denied': ['Permission to read “{name}” was denied.', '读取“{name}”的权限被拒绝。', '「{name}」を読み込む許可が得られませんでした。'],
  'folder.fallback.pictures': ['Until then the wall shows the imported pictures.', '在此之前，墙面显示已导入的图片。', 'それまでは、読み込んだ画像を壁に表示します。'],
  'folder.fallback.music': ['Until then the added music plays.', '在此之前，播放已添加的音乐。', 'それまでは、追加した音楽を再生します。'],
  'folder.noMemory': [
    'This browser cannot remember folders: you will need to choose this one again on your next visit.',
    '此浏览器无法记住文件夹：下次访问时需要重新选择。',
    'このブラウザはフォルダを記憶できません。次に開いたときは、もう一度選び直す必要があります。',
  ],

  'sound.master': ['Master', '总音量', 'マスター'],
  'sound.flips': ['Flip sounds', '翻页声', 'めくり音'],
  'sound.room': ['Room echo (flip sounds)', '房间回响（翻页声）', '部屋の残響（めくり音）'],
  'sound.music': ['Music', '音乐', '音楽'],
  'sound.video': ['Video sound', '视频声音', '動画の音'],
  'sound.duck': ['When a video has sound', '视频有声音时', '動画に音があるとき'],
  'duck.duck': ['Duck music under video sound', '降低音乐音量', '音楽を小さくする'],
  'duck.mix': ['Mix everything', '全部混合', 'すべてミックス'],
  'duck.exclusive': ['Pause music during video sound', '暂停音乐', '音楽を一時停止'],
  'sound.nextTrack': ['Next track', '下一首', '次の曲'],
  'sound.shuffle': ['Shuffle', '随机播放', 'シャッフル'],
  'sound.noMusic': ['No music yet.', '还没有音乐。', 'まだ音楽がありません。'],
  'sound.addMusic': ['+ Add music files', '+ 添加音乐文件', '+ 音楽ファイルを追加'],
  'sound.flipTitle': ['Flip sound', '翻页声', 'めくり音'],
  'sound.now': ['Now:', '当前：', '現在：'],
  'sound.builtin': ['built-in (synthesised)', '内置（合成）', '内蔵（合成音）'],
  'sound.own': ['Use my own sample…', '使用我自己的音效…', '自分の音源を使う…'],
  'sound.reset': ['Back to built-in', '恢复内置', '内蔵に戻す'],
  'sound.mode.import': ['Added music', '已添加的音乐', '追加した音楽'],
  'sound.mode.folder': ['Music folder', '音乐文件夹', '音楽フォルダ'],
  'sound.tracks': ['{n} tracks', '{n} 首', '{n} 曲'],
  'sound.confirmDelete': ['Delete “{name}”?', '要删除“{name}”吗？', '「{name}」を削除しますか？'],
  drop: ['Drop images, videos or music', '拖放图片、视频或音乐', '画像・動画・音楽をドロップ'],
};

const IDX = { en: 0, zh: 1, ja: 2 };
let lang = 'en';
const listeners = [];

export function t(key, vars) {
  const row = T[key];
  let s = row ? row[IDX[lang]] ?? row[0] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function getLang() {
  return lang;
}

export function setLang(l) {
  lang = IDX[l] !== undefined ? l : 'en';
  document.documentElement.lang = HTML_LANG[lang];
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  for (const b of document.querySelectorAll('#lang button')) b.classList.toggle('on', b.dataset.lang === lang);
  listeners.forEach((f) => f(lang));
}

export function onLang(f) {
  listeners.push(f);
}
