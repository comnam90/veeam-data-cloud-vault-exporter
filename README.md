# Veeam Data Cloud Vault Exporter

A simple Chrome extension to export detailed usage and configuration data from the **Veeam Data Cloud Vault** service to a single CSV file.

> **Note:** This extension is specifically designed for the **Vault** service within Veeam Data Cloud. It does not support other VDC services such as M365 or Entra ID.

## ⚠️ Disclaimer

This is an unofficial, community-driven project. It is **not** an official Veeam product and is not endorsed or supported by Veeam Software. Although developed by a Veeam employee, this tool is provided 'as-is' from a personal capacity and is intended for educational and practical purposes within the community.

**Please do not contact Veeam Support for any issues with this extension.** All questions, bugs, and feedback should be reported via the **Issues** tab on this GitHub repository. Use of this tool is entirely at your own risk.

## Features

### Core Export Capabilities

- **Comprehensive Vault Export:** Gathers data from multiple Vault-specific APIs to create a complete picture of your organization's Vault usage.
- **Detailed Tenant Info:** Exports a full list of all provisioned Vault workload tenants, including their status, region, and creation date.
- **Subscription Details:** Links each Vault tenant to its subscription plan, showing edition, limits, and expiration dates.
- **Granular Usage Statistics:** For each tenant, it fetches the monthly storage usage data for every individual storage vault within the Vault service.
- **Single CSV Output:** Combines all the gathered Vault information into a single, "wide" CSV file, perfect for reporting and analysis.

### Smart Export Modes

- **Context-Aware Operation:** The extension automatically adapts based on which Vault page you're viewing:
  - **All Vault Tenants Mode:** Export all Vault tenants in your organization (default)
  - **Single Vault Tenant Mode:** When viewing a specific Vault tenant page, export only that tenant's data
  - **Summary Mode:** Fast export without detailed vault statistics (30-50x faster for large organizations)

### Advanced Features

- **Date Range Filtering:** Filter exports by month range with an intuitive month picker
- **Smart Filenames:** CSV files include dates and tenant names for easy organization
- **Progress Tracking:** Real-time progress indicator shows export status
- **Error Resilience:** Failed tenant fetches are logged but don't stop the export
- **Keyboard Shortcuts:** Press Enter to export, Escape to close popup

## Installation

This extension is not on the Chrome Web Store and must be loaded manually as an "unpacked extension."

### Download the Extension

1. **Download the Latest Release:** Go to the [Releases page](https://github.com/comnam90/veeam-data-cloud-vault-exporter/releases/latest) and download the `Source code (zip)` file (e.g., `veeam-data-cloud-vault-exporter-1.0.0.zip`)
2. **Extract the ZIP:** Extract the downloaded ZIP file to a folder on your computer. Remember this location as you'll need it in the next steps.

### Load into Chrome

3. **Open Chrome Extensions:** Open Google Chrome and navigate to the extensions page by typing `chrome://extensions` in the address bar.
4. **Enable Developer Mode:** In the top-right corner of the extensions page, toggle the **Developer mode** switch on.
5. **Load the Extension:** Click the **Load unpacked** button that appears on the top-left.
6. **Select Folder:** In the file dialog, navigate to and select the folder where you extracted the release files (the folder should contain `manifest.json`, `popup.html`, `popup.js`, and other extension files).

The "VDC Vault Data Exporter" extension should now appear in your list of extensions.

## Usage

### Basic Export

1. **Log In:** Ensure you are logged into your Veeam Data Cloud account in a browser tab.
2. **Navigate to VDC Vault:** Go to any Veeam Data Cloud **Vault** page (organization dashboard, tenant management, or specific tenant page). **Important:** This extension only works on Vault service pages - if you're on other VDC services, the extension will display a message indicating it's not active on those services.
3. **Open the Extension:** Click the extension's icon in the Chrome toolbar. You may need to click the puzzle piece icon first to find and "pin" it.
4. **Configure Export (Optional):**
   - Check **"Filter by date"** to export only specific months of Vault usage data
   - Check **"Tenants summary only"** for a fast export without detailed vault statistics
5. **Start Export:** Click the **Export to CSV** or **Export Tenant to CSV** button (text varies based on context).
6. **Save the File:** The extension will fetch the Vault data (watch the progress indicator). Once complete, a "Save As" dialog will appear with an automatically generated filename like `veeam_data_cloud_vault_export_2025-10-03.csv`.

### Export Modes Explained

#### All Vault Tenants Export (Default)

- **When:** Navigate to your organization's Vault dashboard
- **What:** Exports all Vault tenants in your organization with full details
- **Time:** Several seconds to minutes depending on Vault tenant count
- **Filename:** `veeam_data_cloud_vault_export_YYYY-MM-DD.csv`

#### Single Vault Tenant Export

- **When:** Navigate to a specific Vault tenant's detail page (URL contains `/vault/tenant/{tenant-id}`)
- **What:** Exports only that Vault tenant's data
- **Time:** Very fast (a few seconds)
- **Filename:** `veeam_data_cloud_vault_export_{TenantName}_YYYY-MM-DD.csv`

#### Summary Export

- **When:** On the Vault tenants management page, check "Tenants summary only"
- **What:** Exports basic Vault tenant info without fetching individual vault statistics
- **Time:** Faster than full export
- **Use Case:** Quick overview or when you don't need detailed vault-level data

### Keyboard Shortcuts

- **Enter:** Start export
- **Escape:** Close popup

### Extension Availability

The extension intelligently adapts based on where you are in your browser:

- **✅ Active on VDC Vault Pages:** When you're on any Veeam Data Cloud Vault page (e.g., `cloud.veeam.com/vault/*`), the extension displays the full export interface with all functionality.

- **⚠️ VDC (Non-Vault) Pages:** If you're logged into VDC but viewing a different service (like M365 or Entra ID), the extension displays a message: "This extension currently only supports Veeam Data Cloud **Vault**. Support for other VDC services may be added in the future."

- **🚫 Non-VDC Websites:** If you open the extension on any other website, it displays: "Sorry, this extension is designed for use with Veeam Data Cloud Vault only. Please go to the portal to use it." with a convenient button to navigate to the VDC Vault portal.

This context-aware behavior ensures you always know why the extension may not be showing the export interface.

## CSV Output Columns

The generated CSV file contains Vault-specific data and format depends on the export mode:

### Full/Detailed Export Columns

When exporting with detailed vault statistics (default mode), the CSV contains the following columns:

| Column Name              | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| **TenantDisplayName**    | The friendly name of the Vault workload tenant.                                    |
| **TenantId**             | The unique internal ID for the Vault tenant.                                       |
| **TenantStatus**         | The provisioning status of the Vault tenant (e.g., "PROVISIONED").                 |
| **TenantRegion**         | The deployment region of the Vault tenant service.                                 |
| **TenantCreatedAt**      | The timestamp when the Vault tenant was created.                                   |
| **SubscriptionId**       | The ID of the Vault subscription plan this tenant is assigned to.                  |
| **SubscriptionEdition**  | The edition of the Vault subscription (e.g., "ADVANCED_CORE").                     |
| **SubscriptionLimitTB**  | The storage quota (in TB) associated with the Vault subscription plan.             |
| **SubscriptionExpires**  | The expiration date of the Vault subscription plan.                                |
| **TenantOverallUsageTB** | The total current storage usage for the Vault tenant, as reported in its metadata. |
| **TenantVaultCount**     | The number of storage vaults associated with the Vault tenant.                     |
| **TenantStorageRegions** | A comma-separated list of regions where the Vault tenant has storage vaults.       |
| **VaultDisplayName**     | The friendly name of an individual storage vault within the Vault service.         |
| **VaultStorageName**     | The internal storage name for the vault.                                           |
| **UsageMonth**           | The month for the specific Vault usage data point (e.g., "10/2025").               |
| **UsageTB**              | The storage consumed (in TB) by that vault during that month.                      |

### Summary Export Columns

When using "Tenants summary only" mode, the CSV contains only the Vault tenant-level information (excludes vault-specific columns):

- TenantDisplayName
- TenantId
- TenantStatus
- TenantRegion
- TenantCreatedAt
- SubscriptionId
- SubscriptionEdition
- SubscriptionLimitTB
- SubscriptionExpires
- TenantOverallUsageTB
- TenantVaultCount
- TenantStorageRegions

This provides a quick overview of Vault tenants without the detailed monthly vault statistics.

## Environment Support

This extension works with Veeam Data Cloud when accessing **Vault service** pages at `https://cloud.veeam.com/vault/*`.

**Remember:** The extension will not activate on other VDC service pages (M365, Entra ID, etc.) as it is specifically designed for the Vault service only.

## Troubleshooting

### Extension not working?

- **Check your location:** Make sure you're on a Veeam Data Cloud **Vault** page (URL should contain `/vault`)
  - If on a non-Vault VDC service, you'll see a message indicating the extension only supports Vault
  - If on a non-VDC website, you'll see a button to navigate to the VDC portal
- Ensure you're logged into Veeam Data Cloud
- Reload the extension at `chrome://extensions`
- Check browser console for errors (F12)

### Export taking too long?

- Try using "Tenants summary only" mode for faster results
- Use date filtering to limit the data range

### Failed tenants in export?

- Some tenants may fail to fetch due to API timeouts or permissions
- Failed tenants are included in the CSV with "N/A" values and a warning is shown
- Check the browser console for specific error details

## Acknowledgements

This extension was developed with the assistance of generative AI for tasks including code generation, refactoring, and documentation.

It was also made possible thanks to the following open-source project:

- **Flatpickr**: A lightweight and powerful datetime picker with month selection plugin. (MIT License)

## License

This project is licensed under the MIT License.
