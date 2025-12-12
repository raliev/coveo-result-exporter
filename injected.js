(function() {
    let lastRequest = {
        url: null,
        headers: {},
        body: null
    };

    // ============================================================
    // 1. INTERCEPTOR (Capture Headers & Body) - UNCHANGED
    // ============================================================

    const originalFetch = window.fetch;
    window.fetch = async function(resource, config) {
        captureRequest(resource, config);
        return originalFetch.apply(this, arguments);
    };

    const XHR = XMLHttpRequest.prototype;
    const originalOpen = XHR.open;
    const originalSend = XHR.send;
    const originalSetRequestHeader = XHR.setRequestHeader;

    XHR.open = function(method, url) {
        this._url = url;
        this._headers = {};
        return originalOpen.apply(this, arguments);
    };

    XHR.setRequestHeader = function(header, value) {
        this._headers[header] = value;
        return originalSetRequestHeader.apply(this, arguments);
    };

    XHR.send = function(body) {
        if (this._url) {
            captureRequest(this._url, {
                headers: this._headers,
                body: body
            });
        }
        return originalSend.apply(this, arguments);
    };

    function captureRequest(url, config) {
        let urlStr = (url instanceof Request) ? url.url : url;

        if (urlStr && urlStr.includes('/coveo/rest/search/v2')) {
            if(config && config.body && config.body.includes('actionCause')) {
                // Good candidate
            }

            lastRequest.url = urlStr;
            if (config && config.headers) {
                if (config.headers instanceof Headers) {
                    lastRequest.headers = Object.fromEntries(config.headers.entries());
                } else {
                    lastRequest.headers = { ...config.headers };
                }
            }
            if (config && config.body && typeof config.body === 'string' && config.body.includes('actionCause')) {
                lastRequest.body = config.body;
                if (!lastRequest.headers['Content-Type']) {
                    lastRequest.headers['Content-Type'] = 'application/x-www-form-urlencoded';
                }
            } else if (config && config.body) {
                lastRequest.body = config.body;
            }

            notifyUI("Ready to export (Request captured)");
        }
    }

    function notifyUI(msg, status = 'info') {
        window.postMessage({
            type: 'COVEO_EXPORT_STATUS',
            message: msg,
            status: status
        }, '*');
    }

    // ============================================================
    // 2. EXPORT LOGIC - UNCHANGED
    // ============================================================

    window.addEventListener('message', async (event) => {
        if (event.data.type === 'COVEO_EXPORT_TRIGGER') {
            if (!lastRequest.url) {
                notifyUI("No search detected yet. Please search first.", 'error');
                return;
            }
            performExport(event.data.count);
        }
    });

    async function performExport(count) {
        try {
            notifyUI("Fetching " + count + " records with Debug info...");

            // 1. Prepare Body
            let bodyToSend;
            let isJson = lastRequest.headers['Content-Type'] && lastRequest.headers['Content-Type'].includes('application/json');

            if (isJson) {
                const bodyJson = JSON.parse(lastRequest.body);
                bodyJson.numberOfResults = count;
                bodyJson.debug = true;
                bodyJson.debugRankingInformation = true;
                bodyToSend = JSON.stringify(bodyJson);
            } else {
                const params = new URLSearchParams(lastRequest.body);
                params.set('numberOfResults', count);
                params.set('debug', 'true');
                params.set('debugRankingInformation', 'true');
                bodyToSend = params.toString();
            }

            // 2. Re-Fetch
            const response = await originalFetch(lastRequest.url, {
                method: 'POST',
                headers: lastRequest.headers,
                body: bodyToSend
            });

            if (!response.ok) throw new Error("Network response was not ok: " + response.statusText);

            const data = await response.json();

            if (!data.results) throw new Error("No results in response");

            // 3. Process Data
            // Reset dynamic headers before processing a new batch
            allTermInfoHeaders.clear();
            allQREInfoHeaders.clear();
            const { csvContent } = generateCSV(data.results);

            // 4. Download
            downloadCSV(csvContent);
            notifyUI("Export Complete! (" + data.results.length + " rows)", 'success');

        } catch (e) {
            console.error(e);
            notifyUI("Error: " + e.message, 'error');
        }
    }

    // ============================================================
    // 3. PARSING & CSV GENERATION (FIXED Term Contributions and Properties)
    // ============================================================

    // Global sets to collect all unique dynamic headers across all results
    let allTermInfoHeaders = new Set();
    let allQREInfoHeaders = new Set();

    function parseRankingInfo(infoStr) {
        const info = {
            titleWeight: 0, quality: 0, date: 0, adjacency: 0, source: 0, custom: 0,
            qreTotal: 0,
            rankingFunctions: 0,
            termInfo: {},
            qreInfo: {},
            calculatedDocScore: 0,
            calculatedTermContributions: 0,
            calculatedTotalScore: 0
        };

        if (!infoStr) return info;

        // --- 1. Extract General Weights (and calculate Doc Score) ---
        const docWeightKeys = ["Title", "Quality", "Date", "Adjacency", "Source", "Custom", "QRE", "Ranking functions"];

        const getVal = (name) => {
            const regex = new RegExp(`${name}:\\s*(-?\\d+)`);
            const match = infoStr.match(regex);
            return match ? match[1] : "0";
        };

        let calculatedDocScore = 0;

        docWeightKeys.forEach(key => {
            const val = parseInt(getVal(key), 10);

            let infoKey;
            if (key === "Ranking functions") {
                infoKey = "rankingFunctions";
            } else if (key === "QRE") {
                infoKey = "qreTotal";
            } else {
                infoKey = key.toLowerCase();
                if (key === "Title") infoKey += "Weight";
            }

            info[infoKey] = val;
            calculatedDocScore += val;
        });

        info.calculatedDocScore = calculatedDocScore;

        // --- 2. Parse Detailed QRE Expressions ---
        const qreMatch = infoStr.match(/QRE:\n([\s\S]*?)(\n\nRanking Functions:|\n\nTerms weights:|$)/);
        const qreBlock = qreMatch && qreMatch[1] ? qreMatch[1].trim() : '';

        if (qreBlock) {
            const qreRegex = /Expression:\s*"([^"]*)"\s*Score:\s*(-?\d+)/g;
            let match;
            let index = 1;

            while ((match = qreRegex.exec(qreBlock)) !== null) {
                const expression = match[1];
                const score = match[2];

                let safeName = expression.replace(/@/g, '').replace(/=/g, '_').replace(/"/g, '').substring(0, 50).trim();
                if (safeName.length === 0) {
                    safeName = `Unnamed_QRE_${index}`;
                }

                const headerName = `RI_QRE_Expression_${safeName}`;

                info.qreInfo[headerName] = score;
                allQREInfoHeaders.add(headerName);
                index++;
            }
        }


        // --- 3. Parse Terms Weights (FIXED logic) ---
        const termsMatch = infoStr.match(/Terms weights:\n([\s\S]*?)(\n\nTotal weight|$)/);

        // FIX: termsBlock must reference termsMatch[1]
        const termsBlock = termsMatch && termsMatch[1] ? termsMatch[1].trim() : '';

        let calculatedTermContributions = 0;

        if (termsBlock) {
            // Regex to split the block into term-groups. We use lookahead to ensure we capture the whole group.
            const termGroupRegex = /([a-zA-Z0-9_\-]+:\s*[^;]+;[\s\S]*?)(?=\n\n[a-zA-Z0-9_\-]+:\s*[^;]+;|\n\nTotal weight|$)/g;

            let termGroupMatch;
            let firstKeyword = null;

            // Loop through each group of terms (e.g., fundamentals group, formation group)
            while ((termGroupMatch = termGroupRegex.exec(termsBlock)) !== null) {
                const termGroup = termGroupMatch[1].trim();

                // 1. Find the PRIMARY term (the first one in the group)
                // This will capture 'fundamentals: 100, 39;'
                const primaryTermMatch = termGroup.match(/^(\S+):\s*(-?\d+),\s*(-?\d+);/);
                if (!primaryTermMatch) continue;

                const primaryKeyword = primaryTermMatch[1];
                const primaryN1 = primaryTermMatch[2];
                const primaryN2 = primaryTermMatch[3];

                if (!firstKeyword) {
                    firstKeyword = primaryKeyword;
                }

                // --- A. Store N1/N2 for all terms (including variants) ---
                const termAndVariantRegex = /(\S+):\s*(-?\d+),\s*(-?\d+);/g;
                let termMatch;
                // Reset regex index to ensure it searches from the start of the termGroup
                termAndVariantRegex.lastIndex = 0;
                while((termMatch = termAndVariantRegex.exec(termGroup)) !== null) {
                    const keyword = termMatch[1];
                    const n1 = termMatch[2];
                    const n2 = termMatch[3];

                    allTermInfoHeaders.add(`RI_Term_${keyword}_N1`);
                    allTermInfoHeaders.add(`RI_Term_${keyword}_N2`);
                    info.termInfo[`RI_Term_${keyword}_N1`] = n1;
                    info.termInfo[`RI_Term_${keyword}_N2`] = n2;
                }

                // --- B. Extract Properties and Calculate Term Contributions ---
                // Regex to find all property scores, e.g., 'Title: 276;'
                const propMatchRegex = /(\S+):\s*(-?\d+);/g;
                let propMatch;

                // We need to run the property regex on the WHOLE group text
                propMatchRegex.lastIndex = 0;

                while ((propMatch = propMatchRegex.exec(termGroup)) !== null) {
                    const propName = propMatch[1];
                    const propValue = parseInt(propMatch[2], 10);

                    // Skip the N1/N2 values if they are erroneously captured as properties
                    if (propName.match(/^-?\d+$/) || propName.toLowerCase().match(/n1|n2/)) continue;

                    // 1. Calculate Total Term Contribution (Sum of all field-level weights)
                    calculatedTermContributions += propValue;

                    // 2. Store for dynamic columns, only under the FIRST keyword found in the entire document
                    if (primaryKeyword === firstKeyword) {
                        const headerName = `RI_Term_${primaryKeyword}_${propName}`;
                        allTermInfoHeaders.add(headerName);
                        info.termInfo[headerName] = propValue;
                    }
                }
            }

            info.calculatedTermContributions = calculatedTermContributions;
        }

        info.calculatedTotalScore = info.calculatedDocScore + info.calculatedTermContributions;

        return info;
    }


    /**
     * Generates the CSV content with the original and expanded ranking info.
     * @param {Array<object>} results The array of search result objects.
     * @returns {{csvContent: string}} The generated CSV string.
     */
    function generateCSV(results) {
        // Collect all dynamic headers first by running parseRankingInfo on all results
        const parsedResults = results.map(r => parseRankingInfo(r.rankingInfo));

        // Convert the Sets of dynamic headers to a sorted Array
        const dynamicTermHeaders = Array.from(allTermInfoHeaders).sort();
        const dynamicQREHeaders = Array.from(allQREInfoHeaders).sort();

        const staticHeaders = [
            "Title", "URI",
            "Score",
            "CalculatedScoreTotals",
            "CalculatedScoreDocScore",
            "CalculatedScoreTermContributions",
            "Percent Score", "Ranking Modifier", "Is Recommendation",
            "RI_Title", "RI_Quality", "RI_Date", "RI_Adjacency", "RI_Source", "RI_Custom",
            "RI_QRE_Total",
            "RI_RankingFunctions"
        ];

        const headers = [...staticHeaders, ...dynamicQREHeaders, ...dynamicTermHeaders];

        const rows = results.map((r, index) => {
            const ri = parsedResults[index];
            const termInfo = ri.termInfo;
            const qreInfo = ri.qreInfo;

            // Static fields
            const staticValues = [
                clean(r.title),
                                 clean(r.uri),
                                 r.score,
                                 ri.calculatedTotalScore,
                                 ri.calculatedDocScore,
                                 ri.calculatedTermContributions,
                                 r.percentScore,
                                 clean(r.rankingModifier),
                                 r.isRecommendation,
                                 ri.titleWeight,
                                 ri.quality,
                                 ri.date,
                                 ri.adjacency,
                                 ri.source,
                                 ri.custom,
                                 ri.qreTotal,
                                 ri.rankingFunctions
            ];

            // Dynamic QRE fields
            const dynamicQREValues = dynamicQREHeaders.map(header => {
                return clean(qreInfo[header] || "");
            });

            // Dynamic term fields
            const dynamicTermValues = dynamicTermHeaders.map(header => {
                return clean(termInfo[header] || "");
            });

            return [...staticValues, ...dynamicQREValues, ...dynamicTermValues].join(",");
        });

        return {
            csvContent: [headers.join(","), ...rows].join("\n")
        };
    }

    function clean(str) {
        if (str === null || str === undefined) return "";
        // Escape quotes by doubling them, wrap in quotes
        // Also remove newlines from the string data to ensure single row integrity
        return `"${String(str).replace(/"/g, '""').replace(/[\r\n]+/g, ' ')}"`;
    }

    function downloadCSV(csvString) {
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);

        // Generate filename with timestamp
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, "-");

        link.setAttribute("href", url);
        link.setAttribute("download", `coveo_export_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
})();
