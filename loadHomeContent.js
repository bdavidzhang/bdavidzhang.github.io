document.addEventListener('DOMContentLoaded', function() {
    // State
    const state = {
        podcasts: [],
        writings: [],
        math: [],
        publications: [],
        limits: {
            podcasts: 3,
            writings: 3,
            math: 3,
            publications: 3
        },
        searchTerm: ''
    };

    // Helper function to create a card
    function createCard(title, date, description, link, type) {
        const card = document.createElement('div');
        card.className = 'publication-card'; 
        
        const titleElem = document.createElement('h4');
        titleElem.className = 'pub-title';
        
        if (link && link !== '#') {
            const titleLink = document.createElement('a');
            titleLink.href = link;
            titleLink.textContent = title;
            titleLink.style.textDecoration = 'none';
            titleLink.style.color = 'inherit';
            titleElem.appendChild(titleLink);
        } else {
            titleElem.textContent = title;
        }
        
        const meta = document.createElement('div');
        meta.className = 'pub-meta';
        // If type is provided, show it. If date is provided, show it.
        // For publications, type might be the venue.
        let metaHtml = '';
        if (type) metaHtml += `<span class="pub-venue">${type}</span>`;
        if (type && date) metaHtml += ' | ';
        if (date) metaHtml += `<span>${date}</span>`;
        meta.innerHTML = metaHtml;
        
        const desc = document.createElement('p');
        desc.className = 'pub-desc';
        desc.textContent = description;
        
        card.appendChild(titleElem);
        card.appendChild(meta);
        card.appendChild(desc);
        
        return card;
    }

    // Generic render function
    function renderSection(containerId, data, limit, typeLabel, sectionKey) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = '';
        
        // Filter by search term if exists
        let filteredData = data;
        if (state.searchTerm) {
            const term = state.searchTerm.toLowerCase();
            filteredData = data.filter(item => 
                (item.title && item.title.toLowerCase().includes(term)) ||
                (item.description && item.description.toLowerCase().includes(term)) ||
                (item.guest && item.guest.toLowerCase().includes(term)) ||
                (item.venue && item.venue.toLowerCase().includes(term)) ||
                (item.tags && item.tags.some(tag => tag.toLowerCase().includes(term)))
            );
        }

        // Determine how many to show
        const showCount = state.searchTerm ? filteredData.length : limit;
        const itemsToShow = filteredData.slice(0, showCount);
        
        itemsToShow.forEach(item => {
            let description = item.description || '';
            let date = item.date;
            let type = typeLabel;
            let link = item.link;

            // Specific handling per type
            if (sectionKey === 'podcasts') {
                if (item.guest) description = `Guest: ${item.guest}. ${description}`;
            } else if (sectionKey === 'writings') {
                 if (!description && item.tags && item.tags.length > 0) {
                    description = `Tags: ${item.tags.join(', ')}`;
                 }
                 link = link || (item.slug ? `essay.html?slug=${item.slug}` : '#');
            } else if (sectionKey === 'math') {
                 link = link || (item.slug ? `math-note.html?slug=${item.slug}` : '#');
            } else if (sectionKey === 'publications') {
                // For publications, use venue as type, year as date
                type = item.venue;
                date = item.year;
                // Publications might not have a link in the JSON, handle if they do
            }
            
            const card = createCard(item.title, date, description, link, type);
            container.appendChild(card);
        });

        // Handle "Show More" button
        if (!state.searchTerm && filteredData.length > limit) {
            const btn = document.createElement('button');
            btn.className = 'show-more-btn';
            btn.textContent = 'Show More';
            btn.onclick = function() {
                state.limits[sectionKey] = filteredData.length; 
                renderAll();
            };
            container.appendChild(btn);
        }
    }

    function renderAll() {
        renderSection('podcast-container', state.podcasts, state.limits.podcasts, 'Podcast', 'podcasts');
        renderSection('publications-container', state.publications, state.limits.publications, 'Publication', 'publications');
        renderSection('writings-container', state.writings, state.limits.writings, 'Writing', 'writings');
        renderSection('math-container', state.math, state.limits.math, 'Math Note', 'math');
    }

    // Search Handler
    const searchInput = document.getElementById('content-search');
    if (searchInput) {
        searchInput.addEventListener('input', function(e) {
            state.searchTerm = e.target.value;
            renderAll();
        });
    }

    // Fetch Data
    Promise.all([
        fetch('podcast.json').then(r => r.json()),
        fetch('essay.json').then(r => r.json()),
        fetch('math.json').then(r => r.json()),
        fetch('publications.json').then(r => r.json())
    ]).then(([podcasts, essays, math, publications]) => {
        state.podcasts = podcasts;
        state.publications = publications;
        
        // Sort essays
        state.writings = essays.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        // Sort math
        state.math = math.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        renderAll();
    }).catch(err => console.error('Error loading content:', err));

    // Profile Image Click Handler for Mobile
    const profileContainer = document.querySelector('.profile-image-container');
    if (profileContainer) {
        profileContainer.addEventListener('click', function() {
            this.classList.toggle('is-active');
        });
    }

});
