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

  fetch('essay.json')
      .then(response => response.json())
      .then(data => {
          // Sort essays from newest to oldest
          const sortedEssays = data.sort((a, b) => parseDate(b.date) - parseDate(a.date));

          const essaysContainer = document.querySelector('.essays');
          sortedEssays.forEach(essay => {
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
              
              essaysContainer.appendChild(essayElement);
          });
      })
      .catch(error => console.error('Error fetching essays:', error));
});