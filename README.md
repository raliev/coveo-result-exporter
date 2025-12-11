# Coveo Search Debugger & Exporter

This Chrome Extension is a specialized diagnostic tool designed for engineers and search relevance specialists working with Coveo Search V2 implementations. It injects a control panel into the browser interface, allowing users to replay search requests with elevated debug privileges and export comprehensive ranking data to CSV.

## Overview

Analyzing search relevance often requires inspecting the opaque `rankingInfo` string returned by the Coveo API. This string contains critical data regarding document weights, boosting factors, and query ranking expressions (QRE), but it is returned as a semi-structured text blob that is difficult to parse manually.

This extension automates the analysis workflow by:

1.  Passively intercepting valid authentication tokens and headers from standard user activity.
2.  Replaying the last search request with `debug=true` and `debugRankingInformation=true`.
3.  Parsing the `rankingInfo` blob into discrete, quantifiable metrics.
4.  Exporting the dataset to a structured CSV file for analysis in Excel or Python.

## Features

  * **Floating Control Panel:** An unobtrusive UI injected into the target application for quick access.
  * **Context Capture:** Automatically detects and stores the most recent `fetch` or `XMLHttpRequest` payload to reuse valid Authentication Bearer tokens and session cookies.
  * **Customizable Pagination:** Allows users to override the default page size (e.g., fetching 500 records in a single batch) to analyze macro-level ranking trends.
  * **Ranking Info Parser:** transforming the raw ranking string into separate columns for Title Weight, Quality, Date, Adjacency, Source, Custom, and Terms Weights.
  * **Automated Export:** Generates timestamped CSV files directly in the browser's download directory.

## Installation

This extension is intended for local development and auditing purposes.

1.  Clone or download this repository.
2.  Open Google Chrome and navigate to `chrome://extensions/`.
3.  Enable **Developer mode** in the top right corner.
4.  Click **Load unpacked**.
5.  Select the directory containing the `manifest.json` file.

**Note:** By default, the `manifest.json` is configured to run on specific domains. You must modify the `matches` array in `manifest.json` to include the URL of the Coveo implementation you wish to audit.

```json
"content_scripts": [
  {
    "matches": ["https://www.your-target-domain.com/*"],
    ...
  }
]
```

## Usage

1.  Navigate to the target website containing the Coveo search interface.
2.  **Perform a standard search.** The extension waits for a successful network request to capture the necessary API endpoint, headers, and body payload.
3.  Locate the **Coveo Exporter** panel in the bottom-right corner of the screen.
4.  Enter the desired number of records to retrieve (default: 500).
5.  Click **Export to CSV**.
6.  The status indicator will change to "Requesting data..." followed by "Export Complete\!". The CSV file will automatically download.

## CSV Output Specification

The generated CSV contains the following columns. Fields prefixed with `RI_` are extracted specifically from the `rankingInfo` debug object.

| Column | Description |
| :--- | :--- |
| **Title** | The display title of the document. |
| **URI** | The direct link to the resource. |
| **Score** | The total relevance score assigned by Coveo. |
| **Percent Score** | The score relative to the top result. |
| **Ranking Modifier** | Any modifier applied to the base score. |
| **Is Recommendation** | Boolean flag indicating if the result is a recommendation. |
| **RI\_Title** | Weight contribution from the Title component. |
| **RI\_Quality** | Weight contribution from the Quality component. |
| **RI\_Date** | Weight contribution from the Date/Freshness component. |
| **RI\_Adjacency** | Score based on term proximity. |
| **RI\_Source** | Weight based on the source origin. |
| **RI\_Custom** | Weight from custom ranking expressions (QRE). |
| **RI\_RankingFunctions** | Score contribution from applied ranking functions. |
| **RI\_TermsWeights** | Detailed breakdown of specific term weights (e.g., `keyword: 100`). |

## Technical Architecture

The extension uses a split-context architecture:

  * **Content Script:** Injects the UI elements and listens for user interactions.
  * **Injected Script (Main World):** Monkey-patches `window.fetch` and `XMLHttpRequest` to observe network traffic. This is necessary because Chrome extensions run in an isolated world and cannot directly access the complex `Request` objects or custom headers set by the host page's JavaScript.

## License

MIT
