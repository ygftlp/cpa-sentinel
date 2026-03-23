import codecs
import re

html_path = 'd:/Ai/CPA/CLIProxyAPI_6.8.55_windows_amd64/static/management.html'

with codecs.open(html_path, 'r', 'utf-8') as f:
    html_content = f.read()

# Remove inline injected plugin script
html_content = re.sub(
    r"\n?<script id='cpamc-injected-script'>.*?</script>\n?",
    "\n",
    html_content,
    flags=re.DOTALL
)

# Remove legacy external script references if they exist
html_content = re.sub(
    r"\n?<script src='\./auto_check\.js(?:\?v=\d+)?' charset='UTF-8'></script>\n?",
    "\n",
    html_content
)

with codecs.open(html_path, 'w', 'utf-8') as f:
    f.write(html_content)

print("Successfully removed CPA Sentinel injection from management.html")
