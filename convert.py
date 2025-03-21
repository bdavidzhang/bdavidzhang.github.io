import os
import re
import json
import markdown
from datetime import datetime

def parse_frontmatter(content):
    """
    Manually parse frontmatter from markdown content.
    
    :param content: Full text content of the markdown file
    :return: Tuple of (frontmatter_dict, markdown_content)
    """
    # Regex to match YAML-style frontmatter between triple dashes
    frontmatter_pattern = r'^---\n(.*?)\n---\n(.*)'
    match = re.match(frontmatter_pattern, content, re.DOTALL)
    
    if match:
        # Parse frontmatter manually
        frontmatter_text = match.group(1)
        markdown_text = match.group(2)
        
        # Simple manual parsing of frontmatter
        frontmatter = {}
        for line in frontmatter_text.split('\n'):
            if ':' in line:
                key, value = line.split(':', 1)
                frontmatter[key.strip()] = value.strip()
        
        return frontmatter, markdown_text
    
    # If no frontmatter, return empty dict and full content
    return {}, content

def convert_markdown_to_json(input_file, output_file='essay.json'):
    """
    Convert a markdown file to JSON and append to existing file.
    
    :param input_file: Path to the input markdown file
    :param output_file: Path to the output JSON file (default: essays.json)
    :return: Dictionary containing converted markdown data
    """
    # Read the markdown file
    with open(input_file, 'r', encoding='utf-8') as file:
        file_content = file.read()
    
    # Parse frontmatter
    frontmatter, markdown_content = parse_frontmatter(file_content)
    
    # Determine title (from frontmatter or filename)
    title = frontmatter.get('title', os.path.splitext(os.path.basename(input_file))[0])
    
    # Create slug (convert to lowercase, replace spaces with hyphens)
    slug = title.lower().replace(' ', '-')
    
    # Get date (use current date if not specified in frontmatter)
    date = frontmatter.get('date', datetime.now().strftime("%B %d, %Y"))
    
    # Get tags from frontmatter (default to empty list if not specified)
    tags_str = frontmatter.get('tags', '')
    # Parse tags - either comma-separated or space-separated depending on format
    if ',' in tags_str:
        tags = [tag.strip() for tag in tags_str.split(',')]
    else:
        tags = [tag.strip() for tag in tags_str.split()]
    
    # Convert markdown to HTML
    html_body = markdown.markdown(markdown_content)
    html_body = html_body.replace("\n","<br>")
    
    # Create the JSON structure
    json_data = {
        "title": title,
        "slug": slug,
        "date": date,
        "tags": tags,
        "body": html_body
    }
    
    # Read existing essays or create empty list
    try:
        with open(output_file, 'r', encoding='utf-8') as file:
            essays = json.load(file)
    except (FileNotFoundError, json.JSONDecodeError):
        essays = []
    
    # Check if an essay with the same slug already exists
    existing_essay = next((essay for essay in essays if essay['slug'] == slug), None)
    
    if existing_essay:
        print(f"An essay with slug '{slug}' already exists. Updating it.")
        # Update the existing essay instead of skipping
        for i, essay in enumerate(essays):
            if essay['slug'] == slug:
                essays[i] = json_data
                break
    else:
        # Append new essay
        essays.append(json_data)
    
    # Write updated essays back to file
    with open(output_file, 'w', encoding='utf-8') as file:
        json.dump(essays, file, indent=2)
    
    print(f"Added/updated essay '{title}' to {output_file}")
    return json_data

def main():
    path_to_essay = input()
    path_to_essay = "essays/"+path_to_essay
    markdown_files = []
    markdown_files.append(path_to_essay)
    
    for markdown_file in markdown_files:
        try:
            convert_markdown_to_json(markdown_file)
        except Exception as e:
            print(f"Error processing {markdown_file}: {e}")

if __name__ == "__main__":
    main()