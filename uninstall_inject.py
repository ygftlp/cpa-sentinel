import codecs
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
html_path = BASE_DIR / 'management.html'

with codecs.open(str(html_path), 'r', 'utf-8') as f:
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

with codecs.open(str(html_path), 'w', 'utf-8') as f:
    f.write(html_content)

print("Successfully removed CPA Sentinel injection from management.html")
