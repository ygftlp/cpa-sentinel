import codecs
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
html_path = BASE_DIR / 'management.html'
js_path = BASE_DIR / 'auto_check.js'

with codecs.open(str(js_path), 'r', 'utf-8') as f:
    js_content = f.read()

with codecs.open(str(html_path), 'r', 'utf-8') as f:
    html_content = f.read()

# 1. Remove legacy external script references from older injection methods.
# CPA does not rely on loading custom external JS here; this only cleans up
# historical <script src="./auto_check.js"> remnants before inline injection.
html_content = re.sub(r"<script src='\./auto_check\.js.*?</script>", "", html_content)
html_content = re.sub(r"<script id='cpamc-injected-script'>.*?</script>", "", html_content, flags=re.DOTALL)

# 2. Build the inline script block
inline_script = f"\n<script id='cpamc-injected-script'>\n{js_content}\n</script>\n"

# 3. Inject it back at the last closing tag, not the first text occurrence
body_idx = html_content.rfind('</body>')
html_idx = html_content.rfind('</html>')

if body_idx != -1:
    html_content = html_content[:body_idx] + inline_script + html_content[body_idx:]
elif html_idx != -1:
    html_content = html_content[:html_idx] + inline_script + html_content[html_idx:]
else:
    html_content += inline_script

with codecs.open(str(html_path), 'w', 'utf-8') as f:
    f.write(html_content)

if "cpamc-injected-script" not in html_content:
    raise RuntimeError("Inline injection failed: marker not found in output HTML")

print("Successfully injected JS inline!")
