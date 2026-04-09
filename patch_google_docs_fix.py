import re

with open("src/services/googleDocs.js", "r") as f:
    content = f.read()

# Add missing replacePlaceholderWithList calls
content = content.replace("replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);",
"""replacePlaceholderWithList(body, '{{RESTAURANT_TECHNIQUES}}', recipe.restaurantTechniques || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{CHEF_INSIGHTS}}', recipe.chefInsights || [], DocumentApp.GlyphType.BULLET);
  replacePlaceholderWithList(body, '{{TROUBLESHOOTING}}', recipe.troubleshooting || [], DocumentApp.GlyphType.BULLET);""")

# Add processMarkdownBold
process_markdown_bold_code = """
/**
 * Parses markdown-style **bold** and applies native Google Docs formatting.
 */
function processMarkdownBold(textElement, rawText) {
  const parts = rawText.split(/(\*\*.*?\*\*)/g);
  let cleanText = "";
  const boldRanges = [];

  parts.forEach(part => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const content = part.substring(2, part.length - 2);
      boldRanges.push({ start: cleanText.length, end: cleanText.length + content.length - 1 });
      cleanText += content;
    } else {
      cleanText += part;
    }
  });

  textElement.setText(cleanText);
  boldRanges.forEach(range => textElement.setBold(range.start, range.end, true));
}
"""

content += process_markdown_bold_code

# Update replacePlaceholderWithList to call processMarkdownBold
replace_code_old = """      const listItem = parent.insertListItem(index + i, item);
      listItem.setGlyphType(glyphType);
    });"""

replace_code_new = """      const listItem = parent.insertListItem(index + i, item);
      listItem.setGlyphType(glyphType);
      if (parseBold) processMarkdownBold(listItem.editAsText(), item);
    });"""

content = content.replace(replace_code_old, replace_code_new)

with open("src/services/googleDocs.js", "w") as f:
    f.write(content)

print("Updated googleDocs.js")
