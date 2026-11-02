/* Start the app
   Loaded as a classic script: everything here shares the global scope. Order of <script> tags in index.html matters. */

if (window.SurveyAuth) {
  window.SurveyAuth.init();
} else {
  showDash();
}
