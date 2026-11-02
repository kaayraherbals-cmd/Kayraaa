(function () {
  var d = document.documentElement;
  d.classList.add('js');
  // If the app bundle has not started within 4s, never leave content hidden.
  setTimeout(function () {
    if (!d.dataset.ready) d.classList.add('no-reveal');
  }, 4000);
})();
