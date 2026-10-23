// The rich text editor, TinyMCE (GPL 2 or later), with everything it needs
// bundled, as it ships them minified: its model, theme, icons, plugins
// and skins (light and dark).
// Built as a script of its own (editor.js), loaded the first time an
// editor opens: see components/RichText.tsx.

import tinymce from "tinymce/tinymce.min.js";
import "tinymce/models/dom/model.min.js";
import "tinymce/themes/silver/theme.min.js";
import "tinymce/icons/default/icons.min.js";
import "tinymce/plugins/autolink/plugin.min.js";
import "tinymce/plugins/autoresize/plugin.min.js";
import "tinymce/plugins/link/plugin.min.js";
import "tinymce/plugins/lists/plugin.min.js";
import "tinymce/skins/ui/oxide/skin.js";
import "tinymce/skins/ui/oxide/content.js";
import "tinymce/skins/ui/oxide-dark/skin.js";
import "tinymce/skins/ui/oxide-dark/content.js";
import "tinymce/skins/content/default/content.js";
import "tinymce/skins/content/dark/content.js";

export default tinymce;
