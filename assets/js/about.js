// About questions: expand or collapse all sections.
const toggleButton = document.getElementById('toggle-answers');
const sections = Array.from(document.querySelectorAll('#about-answers details'));
function updateToggle() {
  const allOpen = sections.every(section => section.open);
  toggleButton.textContent = allOpen ? 'Collapse all answers' : 'Expand all answers';
  toggleButton.setAttribute('aria-expanded', String(allOpen));
}
toggleButton.addEventListener('click', () => {
  const expand = !sections.every(section => section.open);
  sections.forEach(section => { section.open = expand; });
  updateToggle();
});
sections.forEach(section => section.addEventListener('toggle', updateToggle));
toggleButton.classList.remove('hidden');
updateToggle();
