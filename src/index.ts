/**
 * StealStickers — Kettu / Bunny Plugin
 *
 * Adds a "📥 Download Sticker" button to the sticker detail ActionSheet
 * (the sheet that appears when you tap "Tap to see sticker" or tap on a sticker).
 *
 * Inspired by Stealmoji by Fierdetta
 * Built for Kettu/Bunny/Revenge
 */

import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

const { Linking } = RN;

let unpatches = [];

// ---------------------------------------------------------------------------
// Sticker info extraction
// ---------------------------------------------------------------------------

/**
 * Extract sticker data from various possible contexts
 * @param {object} context - Could be sticker object, message, or props
 */
function extractStickerInfo(context) {
    if (!context) return null;

    // Direct sticker object (most likely in the sticker detail sheet)
    if (context.id && context.format_type) {
        return buildStickerData(context);
    }

    // Sticker in props.sticker
    if (context.sticker && context.sticker.id) {
        return buildStickerData(context.sticker);
    }

    // Message with stickerItems
    if (context.stickerItems && Array.isArray(context.stickerItems) && context.stickerItems.length > 0) {
        return buildStickerData(context.stickerItems[0]);
    }

    // Message with sticker_items (snake_case)
    if (context.sticker_items && Array.isArray(context.sticker_items) && context.sticker_items.length > 0) {
        return buildStickerData(context.sticker_items[0]);
    }

    // Message with stickers
    if (context.stickers && Array.isArray(context.stickers) && context.stickers.length > 0) {
        return buildStickerData(context.stickers[0]);
    }

    return null;
}

/**
 * Build sticker data object
 * Format types:
 * 1 = PNG (static)
 * 2 = APNG (animated PNG)
 * 3 = Lottie (JSON animation)
 * 4 = GIF (animated GIF)
 */
function buildStickerData(sticker) {
    const formatType = sticker.format_type || 1;
    
    // Map format type to file extension
    let ext;
    switch (formatType) {
        case 1: ext = "png"; break;   // PNG
        case 2: ext = "apng"; break;  // APNG
        case 3: ext = "json"; break;  // Lottie
        case 4: ext = "gif"; break;   // GIF
        default: ext = "png"; break;
    }
    
    return {
        id: sticker.id,
        name: sticker.name || "sticker",
        url: `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}`,
        format: formatType,
        extension: ext
    };
}

// ---------------------------------------------------------------------------
// Download functionality
// ---------------------------------------------------------------------------

/**
 * Download sticker to device
 */
async function downloadSticker(stickerInfo) {
    try {
        const filename = `${stickerInfo.name.replace(/[^a-zA-Z0-9]/g, "_")}_${stickerInfo.id}.${stickerInfo.extension}`;

        // Try to find Discord's file manager
        const fileManager = findByProps("downloadFile", false) || 
                           findByProps("saveFile", false) ||
                           findByProps("downloadAsset", false);

        if (fileManager?.downloadFile) {
            await fileManager.downloadFile(stickerInfo.url, filename);
            showToast(`Downloaded ${stickerInfo.name}! 📥`);
            return;
        }

        if (fileManager?.saveFile) {
            await fileManager.saveFile(stickerInfo.url, filename);
            showToast(`Saved ${stickerInfo.name}! 📥`);
            return;
        }

        // Fallback: Open in browser/external app
        if (Linking) {
            await Linking.openURL(stickerInfo.url);
            showToast("Opened sticker URL 🌐");
        } else {
            showToast("Download not available ❌");
        }

    } catch (e) {
        console.error("[StealStickers] Download failed:", e);
        showToast(`Failed: ${e.message}`);
    }
}

// ---------------------------------------------------------------------------
// ActionSheet patching
// ---------------------------------------------------------------------------

/**
 * Patch the sticker_detail_action_sheet
 */
function patchStickerDetailSheet() {
    try {
        // Find the sticker detail ActionSheet by name
        const StickerDetailSheet = findByName("sticker_detail_action_sheet", false);
        
        if (!StickerDetailSheet) {
            console.warn("[StealStickers] sticker_detail_action_sheet not found");
            return;
        }

        console.log("[StealStickers] Found sticker_detail_action_sheet");

        // Patch the component
        const unpatch = after("type", StickerDetailSheet, (args, res) => {
            try {
                const props = args[0];
                
                // Extract sticker info from various possible locations
                const stickerInfo = extractStickerInfo(props) || 
                                  extractStickerInfo(props?.sticker) ||
                                  extractStickerInfo(props?.message);
                
                if (!stickerInfo) {
                    console.warn("[StealStickers] No sticker info found in props:", Object.keys(props || {}));
                    return res;
                }

                console.log("[StealStickers] Found sticker:", stickerInfo.name, stickerInfo.id);

                // Build our download action
                const downloadAction = {
                    label: "📥 Download Sticker",
                    onPress: () => {
                        downloadSticker(stickerInfo);
                    }
                };

                // Inject into the ActionSheet
                if (res?.props) {
                    // Try direct options array
                    if (Array.isArray(res.props.options)) {
                        res.props.options.push(downloadAction);
                        return res;
                    }

                    // Try children
                    if (res.props.children) {
                        if (Array.isArray(res.props.children)) {
                            // Look for options in children
                            for (const child of res.props.children) {
                                if (child?.props?.options && Array.isArray(child.props.options)) {
                                    child.props.options.push(downloadAction);
                                    return res;
                                }
                            }
                            // Add as new child
                            res.props.children.push(downloadAction);
                        } else {
                            res.props.children = [res.props.children, downloadAction];
                        }
                    } else {
                        res.props.children = downloadAction;
                    }
                }

            } catch (e) {
                console.error("[StealStickers] Error in sticker detail patch:", e);
            }
            
            return res;
        });

        unpatches.push(unpatch);
        console.log("[StealStickers] Patched sticker_detail_action_sheet");
        
    } catch (e) {
        console.error("[StealStickers] Failed to patch sticker detail sheet:", e);
    }
}

/**
 * Alternative: Patch by finding ActionSheet with sticker-related props
 */
function patchStickerSheetByProps() {
    try {
        // Try to find any ActionSheet module related to stickers
        const stickerModule = findByProps("openStickerPickerActionSheet", false) ||
                             findByProps("showStickerSheet", false);
        
        if (!stickerModule) {
            console.warn("[StealStickers] Sticker module not found");
            return;
        }

        console.log("[StealStickers] Found sticker module");
        
        // Look for patchable functions
        const candidates = ["openStickerPickerActionSheet", "showStickerSheet", "default"];
        
        for (const key of candidates) {
            if (typeof stickerModule[key] === "function") {
                const unpatch = after(key, stickerModule, (args, res) => {
                    console.log(`[StealStickers] ${key} called with args:`, args);
                    return res;
                });
                unpatches.push(unpatch);
                console.log(`[StealStickers] Patched ${key}`);
            }
        }
        
    } catch (e) {
        console.error("[StealStickers] Failed to patch by props:", e);
    }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
    onLoad: () => {
        try {
            // Try both patching strategies
            patchStickerDetailSheet();
            patchStickerSheetByProps();

            if (unpatches.length === 0) {
                console.warn(
                    "[StealStickers] No patches applied. " +
                    "Tap a sticker to trigger the ActionSheet load, then re-enable the plugin."
                );
            } else {
                console.log(`[StealStickers] Enabled with ${unpatches.length} patches 📥`);
            }
        } catch (e) {
            console.error("[StealStickers] Failed to load:", e);
        }
    },

    onUnload: () => {
        // Immediate cleanup
        const patchesToClean = [...unpatches];
        unpatches = [];

        for (const unpatch of patchesToClean) {
            try {
                unpatch?.();
            } catch (e) {
                // Silently ignore unpatch errors
            }
        }

        console.log("[StealStickers] Disabled");
    }
};
