// This ensures the script runs after the popup's HTML is loaded
document.addEventListener('DOMContentLoaded', () => {

  // Event listener for the "Go to VDC Portal" button
  document.getElementById('goToPortalButton').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://cloud.veeam.com/vault' });
  });

  // API Configuration - will be set dynamically based on environment
  let API_BASE_URL = '';
  let API_ENDPOINTS = {};

  // Function to build API endpoints based on the base URL
  const buildApiEndpoints = (baseUrl) => {
    return {
      ME: `${baseUrl}/me`,
      SUBSCRIPTIONS: (orgId) => `${baseUrl}/subscriptions-svc/organizations/${orgId}/subscriptions`,
      WORKLOAD_TENANTS: (orgId) => `${baseUrl}/workload-tenants-svc/organizations/${orgId}/workload-tenants?workloadType=VAULT`,
      STORAGE_STATS: (tenantId) => `${baseUrl}/vault/api/cust-StorageAccount/collectionStorageUsedStatistics?wl_tenant_id=${tenantId}`
    };
  };

  // Context-aware state: holds tenant ID if we're in single-tenant mode
  let activeTenantId = null;

  // Cache frequently used elements
  const exportButton = document.getElementById('exportButton');
  const statusEl = document.getElementById('status');
  const filterByDateCheckbox = document.getElementById('filterByDate');
  const dateInputsDiv = document.getElementById('dateInputs');
  const dateFromInput = document.getElementById('dateFrom');
  const dateToInput = document.getElementById('dateTo');
  const titleElement = document.querySelector('h3');

  // Class name for when calendar is open
  const CALENDAR_OPEN_CLASS = 'calendar-is-open';

  // Initialize popup by checking if we're on a single tenant page
  const initializePopup = async () => {
    try {
      // Cache view elements
      const activeView = document.getElementById('activeView');
      const inactiveView = document.getElementById('inactiveView');
      const wrongServiceView = document.getElementById('wrongServiceView');
      
      // Get URL components
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const { hostname, pathname } = new URL(tab.url);

      const isValidDomain = hostname.includes('cloud.veeam.com') || hostname.includes('stage.cloud.veeam.com');

      if (isValidDomain) {
        // User is on a valid VDC domain, now check if it's the right service
        if (pathname.startsWith('/vault')) {
          // --- 1. Correct Context: Show the main app ---
          activeView.style.display = 'block';
          inactiveView.style.display = 'none';
          wrongServiceView.style.display = 'none';
          
          // Run all existing initialization logic for the app
          // Determine environment
          if (hostname.includes('stage.cloud.veeam.com')) {
            API_BASE_URL = 'https://stage.cloud.veeam.com/api';
            console.log('Staging environment detected.');
          } else {
            API_BASE_URL = 'https://cloud.veeam.com/api';
            console.log('Production environment detected.');
          }
          
          // Build the API endpoints object with the correct base URL
          API_ENDPOINTS = buildApiEndpoints(API_BASE_URL);

          // Update the context-aware URL checks to be dynamic
          // The regex now handles optional "/app" segment for staging URLs
          const tenantUrlRegex = new RegExp(`${hostname}\\/vault(?:\\/app)?\\/tenant\\/([0-9a-fA-F-]+)`);
          const match = tab.url.match(tenantUrlRegex);

          // The single-tenant check remains first, as it's the most specific
          if (match && match[1]) {
            activeTenantId = match[1]; // Capture the tenant ID (e.g., "bf0fefcf-...")
            
            // Update UI to show we're in single-tenant mode
            titleElement.textContent = 'Export Single Tenant';
            exportButton.textContent = 'Export Tenant to CSV';
            console.log(`Single tenant mode activated for ID: ${activeTenantId}`);
          
          // Check for either the staging or production summary URL
          } else if (
            (hostname.includes('stage.cloud.veeam.com') && tab.url.endsWith('/vault/manage')) ||
            (hostname.includes('cloud.veeam.com') && tab.url.includes('/vault/manage/tenants'))
          ) {
            // If on the main tenants page, show the summary-only option
            document.getElementById('tenantsSummaryLabel').style.display = 'flex';
            console.log('Tenants summary mode available.');
          } else {
            console.log('All tenants mode activated.');
          }
        } else {
          // --- 2. Right Website, Wrong Service: Show the "Vault only" message ---
          activeView.style.display = 'none';
          inactiveView.style.display = 'none';
          wrongServiceView.style.display = 'block';
          console.log('Extension inactive on this VDC service.');
        }
      } else {
        // --- 3. Wrong Website: Show the "Go to portal" message ---
        activeView.style.display = 'none';
        inactiveView.style.display = 'block';
        wrongServiceView.style.display = 'none';
        console.log('Extension inactive on this domain.');
      }
    } catch (error) {
      console.error('Error initializing popup:', error);
      // Continue in all-tenants mode if there's an error
    }
  };

  // Run the initialization
  initializePopup();

  // Calculate the date limits
  const today = new Date();
  const sixMonthsAgo = new Date();
  // Set the date to 6 months before today
  sixMonthsAgo.setMonth(today.getMonth() - 6);

  // We need to declare the variables here so they can reference each other
  let dateFromPicker, dateToPicker;

  // Initialize the "From" picker with its limits
  dateFromPicker = flatpickr("#dateFrom", {
    dateFormat: "Y-m",
    appendTo: document.body,
    minDate: sixMonthsAgo, // Can't select before 6 months ago
    maxDate: today,        // Can't select past today
    plugins: [
      new monthSelectPlugin({
        shorthand: true,
        dateFormat: "Y-m",
        altFormat: "F Y"
      })
    ],
    onOpen: () => document.body.classList.add(CALENDAR_OPEN_CLASS),
    onClose: () => document.body.classList.remove(CALENDAR_OPEN_CLASS),
    onChange: function(selectedDates) {
      // When "From" changes, update the minimum allowed date for "To"
      if (selectedDates[0]) {
        dateToPicker.set('minDate', selectedDates[0]);
      }
    }
  });

  // Initialize the "To" picker with its limits
  dateToPicker = flatpickr("#dateTo", {
    dateFormat: "Y-m",
    appendTo: document.body,
    minDate: sixMonthsAgo, // Can't select before 6 months ago
    maxDate: today,        // Can't select past today
    plugins: [
      new monthSelectPlugin({
        shorthand: true,
        dateFormat: "Y-m",
        altFormat: "F Y"
      })
    ],
    onOpen: () => document.body.classList.add(CALENDAR_OPEN_CLASS),
    onClose: () => document.body.classList.remove(CALENDAR_OPEN_CLASS),
    onChange: function(selectedDates) {
      // When "To" changes, update the maximum allowed date for "From"
      if (selectedDates[0]) {
        dateFromPicker.set('maxDate', selectedDates[0]);
      }
    }
  });

  // Auto-focus on export button for keyboard accessibility
  exportButton.focus();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Enter key triggers export
    if (e.key === 'Enter' && !exportButton.disabled) {
      exportButton.click();
    }
    
    // Escape key closes popup
    if (e.key === 'Escape') {
      window.close();
    }
  });

  // Date filter toggle handler
  filterByDateCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      dateInputsDiv.style.display = 'block';

      // Get the current date
      const now = new Date();
      const year = now.getFullYear();
      // getMonth() is 0-indexed (0=Jan), so we add 1
      const month = String(now.getMonth() + 1).padStart(2, '0'); 
      const currentMonth = `${year}-${month}`;

      // Set the date on both flatpickr instances
      dateFromPicker.setDate(currentMonth, true); // true triggers the onChange event
      dateToPicker.setDate(currentMonth, true);

    } else {
      dateInputsDiv.style.display = 'none';
      
      // Clear the dates when unchecked
      dateFromPicker.clear();
      dateToPicker.clear();
    }
  });

  // Main click handler
  exportButton.addEventListener('click', async () => {
    // Check if we're in summary-only mode
    const isSummaryOnly = document.getElementById('tenantsSummaryOnly').checked;

    try {
      statusEl.textContent = 'Fetching data...';
      exportButton.disabled = true;

      // Step 1: Get the user's organization ID
      const meResponse = await fetch(API_ENDPOINTS.ME);
      if (!meResponse.ok) throw new Error("Could not fetch user data. Are you logged in?");
      const meData = await meResponse.json();
      const orgId = meData.organizationId;
      if (!orgId) throw new Error("Organization ID not found.");
      statusEl.textContent = `Found Org ID: ${orgId}`;

      // Step 2: Fetch subscriptions and workload tenants
      const subscriptionsUrl = API_ENDPOINTS.SUBSCRIPTIONS(orgId);
      const workloadsUrl = API_ENDPOINTS.WORKLOAD_TENANTS(orgId);
      const [subscriptionsResponse, workloadsResponse] = await Promise.all([ 
        fetch(subscriptionsUrl), 
        fetch(workloadsUrl) 
      ]);

      if (!subscriptionsResponse.ok) throw new Error("Could not fetch subscriptions.");
      if (!workloadsResponse.ok) throw new Error("Could not fetch workload tenants.");

      const subscriptionsData = await subscriptionsResponse.json();
      let workloadsData = await workloadsResponse.json();

      const subscriptionsMap = new Map(subscriptionsData.subscriptions.subscriptions.map(s => [s.id, s]));

      // Check for no tenants
      if (!workloadsData || workloadsData.length === 0) throw new Error("No workload tenants found.");

      // BRANCH: Summary-only mode (fast path)
      if (isSummaryOnly) {
        statusEl.textContent = 'Generating summary CSV...';
        convertSummaryDataToCsv(workloadsData, subscriptionsMap);
        statusEl.className = 'success';
        statusEl.textContent = `✅ Summary export complete! (${workloadsData.length} tenants)`;
      } 
      // Detailed export with vault stats (original path)
      else {
        let filteredWorkloads = workloadsData;
        // Set a default filename
        let baseFilename = 'veeam_data_cloud_export';

        // If we are in single-tenant mode, filter the results!
        if (activeTenantId) {
          const originalCount = workloadsData.length;
          filteredWorkloads = workloadsData.filter(tenant => tenant.id === activeTenantId);
          
          // Handle case where the tenant ID from the URL wasn't found in the API results
          if (filteredWorkloads.length === 0) {
            throw new Error(`Tenant with ID ${activeTenantId} not found in organization's ${originalCount} tenants.`);
          }
          
          // Sanitize tenant name for the filename (replaces spaces/symbols)
          const tenantName = filteredWorkloads[0].displayName.replace(/[^a-zA-Z0-9]/g, '_');
          // Update the filename for single-tenant mode
          baseFilename = `veeam_data_cloud_${tenantName}_export`;
          
          console.log(`Filtered to single tenant: ${filteredWorkloads[0].displayName}`);
        }

        // Step 3: Fetch the detailed stats for each tenant in parallel
        statusEl.textContent = `Fetching stats: 0/${filteredWorkloads.length} (0%)`;
        
        let completed = 0;
        const statPromises = filteredWorkloads.map(async (tenant) => {
          const statsUrl = API_ENDPOINTS.STORAGE_STATS(tenant.id);
          const response = await fetch(statsUrl);
          if (!response.ok) throw new Error(`HTTP ${response.status} for tenant "${tenant.displayName}"`);
          const data = await response.json();
          
          // Update progress
          completed++;
          const percentage = Math.round((completed / workloadsData.length) * 100);
          statusEl.textContent = `Fetching stats: ${completed}/${workloadsData.length} (${percentage}%)`;
          
          return { tenantName: tenant.displayName, tenantId: tenant.id, statsData: data.storageStatistics };
        });
        
        const results = await Promise.allSettled(statPromises);
        const allTenantStats = [];
        const failedTenants = [];
        
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            allTenantStats.push(result.value);
          } else {
            const tenant = filteredWorkloads[index];
            failedTenants.push(tenant.displayName);
            console.error(`Failed to fetch data for tenant "${tenant.displayName}":`, result.reason.message);
            // Include failed tenant with empty stats (will show as N/A in CSV)
            allTenantStats.push({
              tenantName: tenant.displayName,
              tenantId: tenant.id,
              statsData: []
            });
          }
        });

        // Step 4: Call the detailed CSV export function with dynamic filename
        statusEl.textContent = 'Generating CSV...';
        statusEl.className = '';
        convertAllDataToCsv(filteredWorkloads, allTenantStats, subscriptionsMap, baseFilename);
        
        // Show success or warning message
        if (failedTenants.length > 0) {
          statusEl.className = 'warning';
          statusEl.textContent = `⚠️ Export complete with ${failedTenants.length} error(s). Check console for details.`;
          console.warn("Failed to fetch stats for tenants:", failedTenants.join(", "));
        } else {
          statusEl.className = 'success';
          statusEl.textContent = `✅ Export complete! (${filteredWorkloads.length} tenants)`;
        }
      }

    } catch (error) {
      console.error("An error occurred:", error);
      statusEl.className = 'error';
      statusEl.textContent = error.message; // Show error in popup
    } finally {
      exportButton.disabled = false;
    }
  });

  // CSV Escape helper function - escapes quotes per RFC 4180
  function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    // Escape quotes by doubling them
    return stringValue.replace(/"/g, '""');
  }

  // Helper function to trigger CSV download
  function triggerCsvDownload(csvContent, baseFilename) {
    // Build the date string from local timezone components
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // +1 because months are 0-indexed
    const day = String(today.getDate()).padStart(2, '0');
    const localDate = `${year}-${month}-${day}`;

    const filename = `${baseFilename}_${localDate}.csv`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const objUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = objUrl;
    downloadLink.download = filename;
    downloadLink.style.display = 'none';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    setTimeout(() => URL.revokeObjectURL(objUrl), 100);
  }

  // Summary CSV function - creates high-level tenant overview without vault details
  function convertSummaryDataToCsv(workloadsData, subscriptionsMap) {
    const headers = [
      "TenantDisplayName", "TenantId", "TenantStatus", "TenantRegion", "TenantCreatedAt",
      "SubscriptionId", "SubscriptionEdition", "SubscriptionLimitTB", "SubscriptionExpires",
      "TenantOverallUsageTB", "TenantVaultCount", "TenantStorageRegions"
    ];
    let csvContent = headers.join(',') + '\n';

    workloadsData.forEach(tenant => {
      const subscription = subscriptionsMap.get(tenant.subscriptionId);
      let metadata = { tenantUsage: 0, storageAmount: 0, storageRegion: 'N/A' };
      try {
        if (tenant.metadata) metadata = JSON.parse(tenant.metadata);
      } catch (e) {
        console.warn(`Failed to parse metadata for tenant ${tenant.id}:`, e);
      }

      const row = [
        `"${escapeCSV(tenant.displayName)}"`,
        `"${escapeCSV(tenant.id)}"`,
        `"${escapeCSV(tenant.status)}"`,
        `"${escapeCSV(tenant.region)}"`,
        `"${escapeCSV(tenant.createdAt)}"`,
        `"${escapeCSV(tenant.subscriptionId)}"`,
        `"${escapeCSV(subscription?.product.edition || 'N/A')}"`,
        subscription?.count || 0,
        `"${escapeCSV(subscription?.expirationDate || 'N/A')}"`,
        metadata.tenantUsage,
        metadata.storageAmount,
        `"${escapeCSV(metadata.storageRegion)}"`
      ].join(',');
      csvContent += row + '\n';
    });
    
    triggerCsvDownload(csvContent, 'veeam_data_cloud_summary_export');
  }

  // Date filtering helper function
  function isDateInRange(dataDate, fromDate, toDate) {
    // dataDate format: "5/2025" or "10/2025"
    // fromDate/toDate format: "2025-05" or empty string
    
    if (!fromDate && !toDate) return true; // No filtering
    
    // Parse dataDate from "5/2025" to "2025-05"
    const parts = dataDate.split('/');
    if (parts.length !== 2) return true; // Invalid format, include by default
    
    const month = parts[0].padStart(2, '0');
    const year = parts[1];
    const normalizedDate = `${year}-${month}`;
    
    // Check from date
    if (fromDate && normalizedDate < fromDate) return false;
    
    // Check to date
    if (toDate && normalizedDate > toDate) return false;
    
    return true;
  }

  // CSV Conversion function
  function convertAllDataToCsv(workloadsData, allTenantStats, subscriptionsMap, baseFilename) {
    const statsMap = new Map(allTenantStats.map(s => [s.tenantId, s.statsData]));
    let csvContent = [
      "TenantDisplayName", "TenantId", "TenantStatus", "TenantRegion", "TenantCreatedAt",
      "SubscriptionId", "SubscriptionEdition", "SubscriptionLimitTB", "SubscriptionExpires",
      "TenantOverallUsageTB", "TenantVaultCount", "TenantStorageRegions",
      "VaultDisplayName", "VaultStorageName",
      "UsageMonth", "UsageTB"
    ].join(',') + '\n';

    // Determine filter status and values once before the loop
    const filterEnabled = filterByDateCheckbox.checked;
    const fromDate = filterEnabled ? dateFromInput.value : null;
    const toDate = filterEnabled ? dateToInput.value : null;

    workloadsData.forEach(tenant => {
      const subscription = subscriptionsMap.get(tenant.subscriptionId);
      const tenantStats = statsMap.get(tenant.id);
      
      // Safely parse metadata with fallback to defaults
      let metadata = { tenantUsage: 0, storageAmount: 0, storageRegion: 'N/A' };
      try {
        if (tenant.metadata) {
          metadata = JSON.parse(tenant.metadata);
        }
      } catch (e) {
        console.warn(`Failed to parse metadata for tenant ${tenant.id}:`, e);
      }
      if (!tenantStats || tenantStats.length === 0) {
        const row = [
          `"${escapeCSV(tenant.displayName)}"`,
          `"${escapeCSV(tenant.id)}"`,
          `"${escapeCSV(tenant.status)}"`,
          `"${escapeCSV(tenant.region)}"`,
          `"${escapeCSV(tenant.createdAt)}"`,
          `"${escapeCSV(tenant.subscriptionId)}"`,
          `"${escapeCSV(subscription?.product.edition || 'N/A')}"`,
          subscription?.count || 0,
          `"${escapeCSV(subscription?.expirationDate || 'N/A')}"`,
          metadata.tenantUsage,
          metadata.storageAmount,
          `"${escapeCSV(metadata.storageRegion)}"`,
          "N/A",
          "N/A",
          "N/A",
          0
        ].join(',');
        csvContent += row + '\n';
      } else {
        tenantStats.forEach(storage => {
          storage.storageData.forEach(monthlyData => {
            // Skip this month if it's outside the filter range
            if (filterEnabled && !isDateInRange(monthlyData.date, fromDate, toDate)) {
              return;
            }
            
            const row = [
              `"${escapeCSV(tenant.displayName)}"`,
              `"${escapeCSV(tenant.id)}"`,
              `"${escapeCSV(tenant.status)}"`,
              `"${escapeCSV(tenant.region)}"`,
              `"${escapeCSV(tenant.createdAt)}"`,
              `"${escapeCSV(tenant.subscriptionId)}"`,
              `"${escapeCSV(subscription?.product.edition || 'N/A')}"`,
              subscription?.count || 0,
              `"${escapeCSV(subscription?.expirationDate || 'N/A')}"`,
              metadata.tenantUsage,
              metadata.storageAmount,
              `"${escapeCSV(metadata.storageRegion)}"`,
              `"${escapeCSV(storage.displayName)}"`,
              `"${escapeCSV(storage.storageName)}"`,
              `"${escapeCSV(monthlyData.date)}"`,
              monthlyData.storageUsage
            ].join(',');
            csvContent += row + '\n';
          });
        });
      }
    });

    triggerCsvDownload(csvContent, baseFilename);
  }
});