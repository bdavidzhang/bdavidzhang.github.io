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
  
    let allNotes = [];
    const subjectSelector = document.getElementById('subjectSelector');
    const tagSelector = document.getElementById('tagSelector');
    
    fetch('math.json')
        .then(response => response.json())
        .then(data => {
            // Store all notes for filtering
            allNotes = data.sort((a, b) => parseDate(b.date) - parseDate(a.date));
            
            // Extract unique subjects and tags for filter dropdowns
            const allSubjects = new Set();
            const allTags = new Set();
            
            allNotes.forEach(note => {
                if (note.subject) allSubjects.add(note.subject);
                if (note.tags && Array.isArray(note.tags)) {
                    note.tags.forEach(tag => allTags.add(tag));
                }
            });
            
            // Populate subject selector dropdown
            allSubjects.forEach(subject => {
                const option = document.createElement('option');
                option.value = subject;
                option.textContent = subject;
                subjectSelector.appendChild(option);
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
            
            // Initial display of all notes
            displayNotes(allNotes);
            
            // Add event listeners for filtering
            subjectSelector.addEventListener('change', function() {
                filterNotes();
            });
            
            tagSelector.addEventListener('change', function() {
                filterNotes();
            });
        })
        .catch(error => console.error('Error fetching math notes:', error));
    
    function displayNotes(notes) {
        const notesContainer = document.querySelector('.math-notes');
        notesContainer.innerHTML = ''; // Clear current content
        
        notes.forEach(note => {
            const noteElement = document.createElement('div');
            noteElement.classList.add('note-entry');
            
            // Note header
            const headerElement = document.createElement('div');
            headerElement.classList.add('note-header');
            
            const titleElement = document.createElement('h3');
            const titleLink = document.createElement('a');
            titleLink.href = `math-note.html?slug=${note.slug}`;
            titleLink.textContent = note.title;
            titleElement.appendChild(titleLink);
            headerElement.appendChild(titleElement);
            
            const metaElement = document.createElement('div');
            metaElement.classList.add('note-meta');
            metaElement.innerHTML = `<span>Subject: ${note.subject}</span> | <span>${note.date}</span>`;
            headerElement.appendChild(metaElement);
            
            // Description
            if (note.description) {
                const descElement = document.createElement('p');
                descElement.classList.add('note-description');
                descElement.textContent = note.description;
                headerElement.appendChild(descElement);
            }
            
            // Tags
            if (note.tags && Array.isArray(note.tags) && note.tags.length > 0) {
                const tagsElement = document.createElement('p');
                tagsElement.classList.add('tags');
                
                note.tags.forEach((tag, index) => {
                    const tagSpan = document.createElement('span');
                    tagSpan.classList.add('tag');
                    tagSpan.textContent = `#${tag}`;
                    tagSpan.addEventListener('click', function() {
                        tagSelector.value = tag;
                        filterNotes();
                    });
                    
                    tagsElement.appendChild(tagSpan);
                    
                    // Add space between tags
                    if (index < note.tags.length - 1) {
                        tagsElement.appendChild(document.createTextNode(' '));
                    }
                });
                
                headerElement.appendChild(tagsElement);
            }
            
            noteElement.appendChild(headerElement);
            
            // Note links
            if (note.links && Array.isArray(note.links) && note.links.length > 0) {
                const linksElement = document.createElement('div');
                linksElement.classList.add('note-links');
                
                const linksList = document.createElement('ul');
                
                note.links.forEach(link => {
                    const listItem = document.createElement('li');
                    const linkAnchor = document.createElement('a');
                    linkAnchor.href = link.url;
                    linkAnchor.target = '_blank';
                    
                    const linkTitle = document.createElement('span');
                    linkTitle.classList.add('link-title');
                    linkTitle.textContent = link.title;
                    linkAnchor.appendChild(linkTitle);
                    
                    if (link.description) {
                        const linkDescription = document.createElement('div');
                        linkDescription.classList.add('link-description');
                        linkDescription.textContent = link.description;
                        linkAnchor.appendChild(linkDescription);
                    }
                    
                    listItem.appendChild(linkAnchor);
                    linksList.appendChild(listItem);
                });
                
                linksElement.appendChild(linksList);
                noteElement.appendChild(linksElement);
            }
            
            notesContainer.appendChild(noteElement);
        });
        
        // Show message if no notes match the filter
        if (notes.length === 0) {
            const noNotesMsg = document.createElement('p');
            noNotesMsg.textContent = 'No math notes found with the selected filters.';
            notesContainer.appendChild(noNotesMsg);
        }
    }
    
    function filterNotes() {
        const selectedSubject = subjectSelector.value;
        const selectedTag = tagSelector.value;
        
        let filteredNotes = allNotes;
        
        if (selectedSubject !== 'all') {
            filteredNotes = filteredNotes.filter(note => note.subject === selectedSubject);
        }
        
        if (selectedTag !== 'all') {
            filteredNotes = filteredNotes.filter(note => 
                note.tags && Array.isArray(note.tags) && note.tags.includes(selectedTag)
            );
        }
        
        displayNotes(filteredNotes);
    }
});
