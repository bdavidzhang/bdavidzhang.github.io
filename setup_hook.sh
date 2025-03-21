#!/bin/bash

# Create the pre-commit hook script
mkdir -p .git/hooks
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash

echo "Running pre-commit hook to process markdown files..."

# Check if essays directory exists
if [ ! -d "essays" ]; then
    echo "Warning: 'essays' directory not found. Skipping essay processing."
    exit 0
fi

# Get a list of all markdown files in the essays directory
markdown_files=$(find essays -name "*.md")

# Check if any markdown files were found
if [ -z "$markdown_files" ]; then
    echo "No markdown files found in the essays directory. Skipping essay processing."
    exit 0
fi

# Count the number of files to process
file_count=$(echo "$markdown_files" | wc -l)
echo "Found $file_count markdown files to process..."

# Modify convert.py to accept file path as command line argument
# This is a temporary modification to allow batch processing
cp convert.py convert_batch.py
sed -i 's/path_to_essay = input()/import sys\n    if len(sys.argv) > 1:\n        path_to_essay = sys.argv[1]\n    else:\n        path_to_essay = input()/' convert_batch.py
sed -i 's/path_to_essay = "essays\/"+path_to_essay/# Only add essays\/ prefix if not already present\n    if not path_to_essay.startswith("essays\/"):\n        path_to_essay = "essays\/"+path_to_essay/' convert_batch.py

# Process each markdown file
for file in $markdown_files; do
    echo "Processing: $file"
    python convert_batch.py "$file"
done

# Remove the temporary modified script
rm convert_batch.py

# Stage the updated essay.json file
git add essay.json

echo "All markdown files processed successfully!"
EOF

# Make the hook executable
chmod +x .git/hooks/pre-commit

echo "Git pre-commit hook installed successfully!"
echo "Now your essays will be automatically processed before each commit."