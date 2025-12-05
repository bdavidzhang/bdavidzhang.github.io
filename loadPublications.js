document.addEventListener('DOMContentLoaded', function() {
    fetch('publications.json')
        .then(response => response.json())
        .then(data => {
            const container = document.getElementById('publications-container');
            
            data.forEach(pub => {
                const card = document.createElement('div');
                card.className = 'publication-card';
                
                const title = document.createElement('h4');
                title.className = 'pub-title';
                title.textContent = pub.title;
                
                const meta = document.createElement('div');
                meta.className = 'pub-meta';
                meta.innerHTML = `<span class="pub-venue">${pub.venue}</span>`;
                
                const desc = document.createElement('p');
                desc.className = 'pub-desc';
                desc.textContent = pub.description;
                
                card.appendChild(title);
                card.appendChild(meta);
                card.appendChild(desc);
                
                container.appendChild(card);
            });
        })
        .catch(error => console.error('Error loading publications:', error));
});