(function() {
    let lastRequest = {
        url: null,
        headers: {},
        body: null
    };

    // ============================================================
    // 1. INTERCEPTOR (Capture Headers & Body)
    // ============================================================
    
    // Hook Fetch
    const originalFetch = window.fetch;
    window.fetch = async function(resource, config) {
        captureRequest(resource, config);
        return originalFetch.apply(this, arguments);
    };

    // Hook XHR (for legacy Coveo calls)
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
        // Convert Request object to string URL if needed
        let urlStr = (url instanceof Request) ? url.url : url;
        
        if (urlStr && urlStr.includes('/coveo/rest/search/v2')) {
            // Only capture the main search query, ignore analytics/suggestions if possible
            if(config && config.body && config.body.includes('actionCause')) {
                 // Good candidate
            }
            
            lastRequest.url = urlStr;
            // Copy headers carefully
            if (config && config.headers) {
                if (config.headers instanceof Headers) {
                    lastRequest.headers = Object.fromEntries(config.headers.entries());
                } else {
                    lastRequest.headers = { ...config.headers };
                }
            }
            lastRequest.body = config ? config.body : null;
            
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
    // 2. EXPORT LOGIC
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
            const params = new URLSearchParams(lastRequest.body);
            params.set('numberOfResults', count);
            params.set('debug', 'true');
            params.set('debugRankingInformation', 'true'); // Crucial for rankingInfo field

            // 2. Re-Fetch
            const response = await originalFetch(lastRequest.url, {
                method: 'POST',
                headers: lastRequest.headers,
                body: params.toString()
            });

            if (!response.ok) throw new Error("Network response was not ok");
            
            const data = await response.json();
            
            if (!data.results) throw new Error("No results in response");

            // 3. Process Data
            const csvContent = generateCSV(data.results);
            
            // 4. Download
            downloadCSV(csvContent);
            notifyUI("Export Complete!", 'success');

        } catch (e) {
            console.error(e);
            notifyUI("Error: " + e.message, 'error');
        }
    }

    // ============================================================
    // 3. PARSING & CSV GENERATION
    // ============================================================

    function parseRankingInfo(infoStr) {
        // Default object
        const info = {
            titleWeight: 0,
            quality: 0,
            date: 0,
            adjacency: 0,
            source: 0,
            custom: 0,
            rankingFunctions: 0,
            termsWeights: ""
        };

        if (!infoStr) return info;

        // Helper regex for "Name: Value;" pattern in "Document weights" section
        const getVal = (name) => {
            const regex = new RegExp(`${name}:\\s*(-?\\d+)`);
            const match = infoStr.match(regex);
            return match ? match[1] : "0";
        };

        info.titleWeight = getVal("Title");
        info.quality = getVal("Quality");
        info.date = getVal("Date");
        info.adjacency = getVal("Adjacency");
        info.source = getVal("Source");
        info.custom = getVal("Custom");
        
        // Ranking functions might appear twice (in weights and as a section), 
        // usually we want the weight score from "Ranking functions: X;"
        const rfMatch = infoStr.match(/Ranking functions:\s*(-?\d+);/i);
        info.rankingFunctions = rfMatch ? rfMatch[1] : "0";

        // Parse Terms Weights: complex multiline section
        // Look for "Terms weights:" and take everything until "Total weight" or end
        const termsMatch = infoStr.match(/Terms weights:\n([\s\S]*?)(\n\nTotal weight|$)/);
        if (termsMatch && termsMatch[1]) {
            // Clean up newlines and commas for CSV safety
            info.termsWeights = termsMatch[1].replace(/[\n\r]+/g, " | ").trim();
        }

        return info;
    }

    function generateCSV(results) {
        const headers = [
            "Title", 
            "URI", 
            "Score", 
            "Percent Score", 
            "Ranking Modifier", 
            "Is Recommendation",
            "RI_Title", 
            "RI_Quality", 
            "RI_Date", 
            "RI_Adjacency", 
            "RI_Source", 
            "RI_Custom", 
            "RI_RankingFunctions", 
            "RI_TermsWeights"
        ];

        const rows = results.map(r => {
            // Parse the raw string from result.rankingInfo
            const ri = parseRankingInfo(r.rankingInfo);

            return [
                clean(r.title),
                clean(r.uri),
                r.score,
                r.percentScore,
                clean(r.rankingModifier),
                r.isRecommendation,
                ri.titleWeight,
                ri.quality,
                ri.date,
                ri.adjacency,
                ri.source,
                ri.custom,
                ri.rankingFunctions,
                clean(ri.termsWeights)
            ].join(",");
        });

        return [headers.join(","), ...rows].join("\n");
    }

    function clean(str) {
        if (str === null || str === undefined) return "";
        // Escape quotes by doubling them, wrap in quotes
        return `"${String(str).replace(/"/g, '""')}"`;
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
