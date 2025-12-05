document.addEventListener('DOMContentLoaded', function() {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');

  if (slug) {
    fetch('math.json')
      .then(response => response.json())
      .then(data => {
        const note = data.find(n => n.slug === slug);
        if (note) {
          const noteContent = document.querySelector('.math-note-content');
          
          const titleElement = document.createElement('h1');
          titleElement.textContent = note.title;
          noteContent.appendChild(titleElement);
          
          const metaContainer = document.createElement('div');
          metaContainer.classList.add('note-meta-container');
          
          const subjectElement = document.createElement('p');
          subjectElement.classList.add('subject');
          subjectElement.innerHTML = `<strong>Subject:</strong> ${note.subject}`;
          metaContainer.appendChild(subjectElement);
          
          const dateElement = document.createElement('p');
          dateElement.classList.add('date');
          dateElement.innerHTML = `<strong>Date:</strong> ${note.date}`;
          metaContainer.appendChild(dateElement);
          
          noteContent.appendChild(metaContainer);
          
          // Add description if it exists
          if (note.description) {
            const descriptionElement = document.createElement('p');
            descriptionElement.classList.add('description');
            descriptionElement.textContent = note.description;
            noteContent.appendChild(descriptionElement);
          }
          
          // Add tags if they exist
          if (note.tags && Array.isArray(note.tags) && note.tags.length > 0) {
              const tagsElement = document.createElement('p');
              tagsElement.classList.add('tags');
              
              note.tags.forEach((tag, index) => {
                  const tagSpan = document.createElement('span');
                  tagSpan.classList.add('tag');
                  tagSpan.textContent = `#${tag}`;
                  tagSpan.addEventListener('click', function() {
                      window.location.href = `math.html?tag=${tag}`;
                  });
                  
                  tagsElement.appendChild(tagSpan);
                  
                  // Add space between tags
                  if (index < note.tags.length - 1) {
                      tagsElement.appendChild(document.createTextNode(' '));
                  }
              });
              
              noteContent.appendChild(tagsElement);
          }
          
          // Add links section
          if (note.links && Array.isArray(note.links) && note.links.length > 0) {
            const linksTitle = document.createElement('h2');
            linksTitle.textContent = 'Resources';
            noteContent.appendChild(linksTitle);
            
            const linksContainer = document.createElement('div');
            linksContainer.classList.add('note-links');
            
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
            
            linksContainer.appendChild(linksList);
            noteContent.appendChild(linksContainer);
          }
          
          // Add back link
          const backLink = document.createElement('p');
          backLink.classList.add('back-link');
          backLink.innerHTML = `<a href="math.html">&larr; Back to Math Notes</a>`;
          noteContent.appendChild(backLink);
          
        } else {
          console.error('Math note not found');
        }
      })
      .catch(error => console.error('Error fetching math note:', error));
  } else {
    console.error('No slug provided in URL');
  }
});
