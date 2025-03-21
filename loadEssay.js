document.addEventListener('DOMContentLoaded', function() {
  const urlParams = new URLSearchParams(window.location.search);
  const slug = urlParams.get('slug');

  if (slug) {
    fetch('essay.json')
      .then(response => response.json())
      .then(data => {
        const essay = data.find(e => e.slug === slug);
        if (essay) {
          const essayContent = document.querySelector('.essay-content');
          
          const titleElement = document.createElement('h1');
          titleElement.textContent = essay.title;
          essayContent.appendChild(titleElement);
          
          const dateElement = document.createElement('p');
          dateElement.classList.add('date');
          dateElement.textContent = essay.date;
          essayContent.appendChild(dateElement);
          
          // Add tags if they exist
          if (essay.tags && Array.isArray(essay.tags) && essay.tags.length > 0) {
              const tagsElement = document.createElement('p');
              tagsElement.classList.add('tags');
              
              essay.tags.forEach((tag, index) => {
                  const tagSpan = document.createElement('span');
                  tagSpan.classList.add('tag');
                  tagSpan.textContent = `#${tag}`;
                  tagSpan.addEventListener('click', function() {
                      window.location.href = `writing.html?tag=${tag}`;
                  });
                  
                  tagsElement.appendChild(tagSpan);
                  
                  // Add space between tags
                  if (index < essay.tags.length - 1) {
                      tagsElement.appendChild(document.createTextNode(' '));
                  }
              });
              
              essayContent.appendChild(tagsElement);
          }
          
          const bodyElement = document.createElement('div');
          bodyElement.innerHTML = essay.body;
          essayContent.appendChild(bodyElement);
        } else {
          console.error('Essay not found');
        }
      })
      .catch(error => console.error('Error fetching essay:', error));
  } else {
    console.error('No slug provided in URL');
  }
});