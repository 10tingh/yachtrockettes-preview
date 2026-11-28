/* Site settings that are likely to change. Edit the values here, nothing else needs touching. */
window.SITE_CONFIG = {
  /* Google Calendar API key for the Upcoming shows list and the hero "next show" chip. It is visible in the page source, so it is
     restricted in Google Cloud: HTTP referrers = http://127.0.0.1:8080, http://localhost:8080, yachtrockettes.com and the tylerentingh.com preview,
     and the Google Calendar API only. When the site is hosted somewhere else (the production host), add that host to the key's
     website restrictions, or the list falls back to its message and calendar link. If this is empty or a "PASTE..." placeholder
     no request is sent to Google. */
  googleCalendarApiKey: 'AIzaSyBnvhm3AbZ-46wHwRmFnnBS_YxpxcuHKI0',

  /* The main contact email. Every visible email and mailto link on the page is filled from this one value.
     (The static "email" in the schema at the top of index.html has to match it: search the page for it if this changes.) */
  contactEmail: 'yachtrockettes@gmail.com',

  /* The Formspree form the booking form posts to (the part after /f/ in https://formspree.io/f/moedzjqz). The visitor's "email"
     field is used as the reply-to. Notifications go to the email the form was created with: switch the form's target email to
     the contact email below in the Formspree dashboard (see the README pre-launch checklist). While this value is empty or a
     "PASTE..." placeholder the booking form sends nothing and shows the error message with an email link instead. */
  formspreeFormId: 'moedzjqz',

  /* The band's public Google Calendar (must stay shared as "Make available to public") */
  googleCalendarId: 'a7b68q49t730bv3icl5p7povks@group.calendar.google.com'
};
