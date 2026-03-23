import codecs
import re

html_path = 'd:/Ai/CPA/CLIProxyAPI_6.8.55_windows_amd64/static/management.html'
js_path = 'd:/Ai/CPA/CLIProxyAPI_6.8.55_windows_amd64/static/auto_check.js'

with codecs.open(js_path, 'r', 'utf-8') as f:
    js_content = f.read()

with codecs.open(html_path, 'r', 'utf-8') as f:
    html_content = f.read()

# 1. Strip the old external script tags
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

with codecs.open(html_path, 'w', 'utf-8') as f:
    f.write(html_content)

if "cpamc-injected-script" not in html_content:
    raise RuntimeError("Inline injection failed: marker not found in output HTML")

print("Successfully injected JS inline!")
