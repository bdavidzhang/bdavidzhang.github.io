#!/usr/bin/env python3
import os
import sys
import glob
import json
import importlib.util

def main():
    """Process all markdown files in the essays directory"""
    # Check if essays directory exists
    if not os.path.isdir("essays"):
        print("Error: 'essays' directory not found!")
        return 1
    
    # Find all markdown files
    markdown_files = glob.glob("essays/*.md")
    
    if not markdown_files:
        print("No markdown files found in the essays directory.")
        return 0
    
    print(f"Found {len(markdown_files)} markdown files to process...")
    
    # Import the convert.py module dynamically
    spec = importlib.util.spec_from_file_location("convert", "convert.py")
    convert_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(convert_module)
    
    # Process each file
    for file_path in markdown_files:
        print(f"Processing: {file_path}")
        try:
            convert_module.convert_markdown_to_json(file_path)
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
    
    print("All markdown files processed successfully!")
    return 0

if __name__ == "__main__":
    sys.exit(main())