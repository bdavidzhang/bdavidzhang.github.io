document.addEventListener('DOMContentLoaded', function() {
    // Function to parse date string into a Date object
    function parseDate(dateString) {
        const months = {
            'January': 0, 'February': 1, 'March': 2, 'April': 3, 
            'May': 4, 'June': 5, 'July': 6, 'August': 7, 
            'September': 8, 'October': 9, 'November': 10, 'December': 11
        };
        
        const parts = dateString.split(' ');
        const month = months[parts[0]];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        
        return new Date(year, month, day);
    }
  
    let allEssays = [];
    const tagSelector = document.getElementById('tagSelector');
    
    fetch('essay.json')
        .then(response => response.json())
        .then(data => {
            // Store all essays for filtering
            allEssays = data.sort((a, b) => parseDate(b.date) - parseDate(a.date));
            
            // Extract unique tags for the filter dropdown
            const allTags = new Set();
            allEssays.forEach(essay => {
                if (essay.tags && Array.isArray(essay.tags)) {
                    essay.tags.forEach(tag => allTags.add(tag));
                }
            });
            
            // Populate tag selector dropdown
            allTags.forEach(tag => {
                if (tag && tag.trim() !== '') {
                    const option = document.createElement('option');
                    option.value = tag;
                    option.textContent = tag;
                    tagSelector.appendChild(option);
                }
            });
            
            // Initial display of all essays
            displayEssays(allEssays);
            
            // Add event listener for tag selection
            tagSelector.addEventListener('change', function() {
                const selectedTag = this.value;
                filterEssaysByTag(selectedTag);
            });
        })
        .catch(error => console.error('Error fetching essays:', error));
    
    function displayEssays(essays) {
        const essaysContainer = document.querySelector('.essays');
        essaysContainer.innerHTML = ''; // Clear current content
        
        essays.forEach(essay => {
            const essayElement = document.createElement('div');
            essayElement.classList.add('essay');
            
            const titleElement = document.createElement('h2');
            const titleLink = document.createElement('a');
            titleLink.href = `essay.html?slug=${essay.slug}`;
            titleLink.textContent = essay.title;
            titleElement.appendChild(titleLink);
            essayElement.appendChild(titleElement);
            
            const dateElement = document.createElement('p');
            dateElement.classList.add('date');
            dateElement.textContent = essay.date;
            essayElement.appendChild(dateElement);
            
            // Add tags if they exist
            if (essay.tags && Array.isArray(essay.tags) && essay.tags.length > 0) {
                const tagsElement = document.createElement('p');
                tagsElement.classList.add('tags');
                
                essay.tags.forEach((tag, index) => {
                    const tagSpan = document.createElement('span');
                    tagSpan.classList.add('tag');
                    tagSpan.textContent = `#${tag}`;
                    tagSpan.addEventListener('click', function() {
                        tagSelector.value = tag;
                        filterEssaysByTag(tag);
                    });
                    
                    tagsElement.appendChild(tagSpan);
                    
                    // Add space between tags
                    if (index < essay.tags.length - 1) {
                        tagsElement.appendChild(document.createTextNode(' '));
                    }
                });
                
                essayElement.appendChild(tagsElement);
            }
            
            essaysContainer.appendChild(essayElement);
        });
        
        // Show message if no essays match the filter
        if (essays.length === 0) {
            const noEssaysMsg = document.createElement('p');
            noEssaysMsg.textContent = 'No essays found with this tag.';
            essaysContainer.appendChild(noEssaysMsg);
        }
    }
    
    function filterEssaysByTag(tag) {
        if (tag === 'all') {
            displayEssays(allEssays);
        } else {
            const filteredEssays = allEssays.filter(essay => 
                essay.tags && Array.isArray(essay.tags) && essay.tags.includes(tag)
            );
            displayEssays(filteredEssays);
        }
    }
  });