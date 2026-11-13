# Overview

State of the Surf Analytics semantic model: how well it is documented, which rules it breaks, and what has been raised on GitHub.

<div id="dashboard">
  <div class="dash-filters" role="group" aria-label="Filters">
    <label>Table <select id="f-table"><option value="">All tables</option></select></label>
    <label>Owner <select id="f-owner"><option value="">All owners</option></select></label>
    <label>Category <select id="f-category"><option value="">All categories</option></select></label>
    <label>Severity <select id="f-severity">
      <option value="">All severities</option><option value="error">Error</option>
      <option value="warning">Warning</option><option value="info">Info</option></select></label>
    <label>Rule status <select id="f-status">
      <option value="fail">Failing</option><option value="pass">Passing</option><option value="">All</option></select></label>
  </div>
  <p id="dash-note" class="dash-note"></p>
  <div id="dash-tiles" class="dash-tiles"></div>
  <div class="dash-charts">
    <section><h3>Documentation coverage by table</h3><div id="chart-coverage"></div></section>
    <section><h3>Rule failures by severity</h3><div id="chart-severity"></div></section>
    <section><h3>Rule failures by category</h3><div id="chart-category"></div></section>
    <section><h3>Open issues by table</h3><div id="chart-issues"></div></section>
  </div>
  <h2 id="rules-heading">Rule results</h2>
  <p class="dash-note">What each rule checks, and which come from the Best Practice Analyzer, is on the <a href="rules/">Rules</a> page.</p>
  <div id="rules-table"></div>
  <h2>Issues</h2>
  <div id="issues-table"></div>
</div>
