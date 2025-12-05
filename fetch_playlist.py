import urllib.request
import re
import json
import html

url = "https://www.youtube.com/playlist?list=PLYIFstZ3YIsweIETL9Ty7aow1yAEcKW_Z"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
}

try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as response:
        content = response.read().decode('utf-8')
        
    # Look for ytInitialData
    match = re.search(r'var ytInitialData = ({.*?});', content)
    if match:
        data_str = match.group(1)
        data = json.loads(data_str)
        
        videos = []
        
        # Navigate through the JSON structure to find playlist items
        # This path is based on typical YouTube structure, might need adjustment
        try:
            tabs = data['contents']['twoColumnBrowseResultsRenderer']['tabs']
            for tab in tabs:
                if 'tabRenderer' in tab:
                    content_items = tab['tabRenderer']['content']['sectionListRenderer']['contents'][0]['itemSectionRenderer']['contents'][0]['playlistVideoListRenderer']['contents']
                    
                    for item in content_items:
                        if 'playlistVideoRenderer' in item:
                            video_data = item['playlistVideoRenderer']
                            video_id = video_data['videoId']
                            title = video_data['title']['runs'][0]['text']
                            link = f"https://www.youtube.com/watch?v={video_id}&list=PLYIFstZ3YIsweIETL9Ty7aow1yAEcKW_Z"
                            videos.append({'title': title, 'link': link})
                            
            print(json.dumps(videos, indent=2))
            
        except KeyError as e:
            print(f"Error parsing JSON structure: {e}")
            # Fallback regex search if JSON structure fails
            print("Attempting fallback regex search...")
            video_ids = re.findall(r'"videoId":"(.*?)"', content)
            titles = re.findall(r'"title":{"runs":\[{"text":"(.*?)"}\]', content)
            
            # This fallback is very rough and might mismatch
            # Better to rely on the JSON structure if possible
            
    else:
        print("Could not find ytInitialData")

except Exception as e:
    print(f"Error: {e}")
