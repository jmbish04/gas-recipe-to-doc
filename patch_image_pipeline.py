with open("src/services/imagePipeline.js", "r") as f:
    content = f.read()

# We need to remove the FIRST definition of processAndInjectRecipeImage
# (lines ~269 to ~322) because the second one has helper functions it calls.
import re

pattern = re.compile(r'function processAndInjectRecipeImage\(cloudflareImageUrl, docId\) \{[\s\S]*?(?=function processAndInjectRecipeImage\(cloudflareImageUrl, docId\) \{)')

content = pattern.sub('', content)

with open("src/services/imagePipeline.js", "w") as f:
    f.write(content)

print("Updated imagePipeline.js")
