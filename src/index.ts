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
 * Recursively walk React tree and inject our option
 */
function walkTreeAndInject(tree, downloadAction, depth = 0) {
    if (!tree || depth > 10) return false; // Prevent infinite recursion
    
    // Check if this node has an options array
    if (tree.props?.options && Array.isArray(tree.props.options)) {
        console.log(`[StealStickers] Found options array at depth ${depth}:`, tree.props.options.map(o => o.label));
        tree.props.options.push(downloadAction);
        console.log("[StealStickers] ✅ Injected download option!");
        return true;
    }
    
    // Recurse into children
    if (tree.props?.children) {
        if (Array.isArray(tree.props.children)) {
            for (const child of tree.props.children) {
                if (walkTreeAndInject(child, downloadAction, depth + 1)) {
                    return true;
                }
            }
        } else {
            return walkTreeAndInject(tree.props.children, downloadAction, depth + 1);
        }
    }
    
    return false;
}

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

        console.log("[StealStickers] ✅ Found sticker_detail_action_sheet");

        // Patch the component
        const unpatch = after("type", StickerDetailSheet, (args, res) => {
            try {
                const props = args[0];
                
                console.log("[StealStickers] Sheet opened! Props keys:", Object.keys(props || {}));
                
                // Extract sticker info from various possible locations
                const stickerInfo = extractStickerInfo(props) || 
                                  extractStickerInfo(props?.sticker) ||
                                  extractStickerInfo(props?.message);
                
                if (!stickerInfo) {
                    console.warn("[StealStickers] ❌ No sticker info found");
                    console.log("[StealStickers] Props:", JSON.stringify(props, null, 2));
                    return res;
                }

                console.log("[StealStickers] ✅ Found sticker:", stickerInfo.name, `(${stickerInfo.id})`);

                // Build our download action
                const downloadAction = {
                    label: "📥 Download Sticker",
                    onPress: () => {
                        console.log("[StealStickers] Download button pressed!");
                        downloadSticker(stickerInfo);
                    }
                };

                console.log("[StealStickers] Attempting to inject option...");
                console.log("[StealStickers] Return value type:", res?.type?.name || typeof res);
                
                // Try recursive tree walk
                if (walkTreeAndInject(res, downloadAction)) {
                    return res;
                }

                console.warn("[StealStickers] ⚠️ Could not find options array in tree");
                console.log("[StealStickers] Full return structure:", JSON.stringify(res, (key, val) => {
                    if (key === 'children' && Array.isArray(val)) return `[${val.length} children]`;
                    if (typeof val === 'function') return '[Function]';
                    if (typeof val === 'object' && val !== null && Object.keys(val).length > 5) return '[Object]';
                    return val;
                }, 2));

            } catch (e) {
                console.error("[StealStickers] ❌ Error in sticker detail patch:", e);
            }
            
            return res;
        });

        unpatches.push(unpatch);
        console.log("[StealStickers] ✅ Patched sticker_detail_action_sheet");
        
    } catch (e) {
        console.error("[StealStickers] ❌ Failed to patch sticker detail sheet:", e);
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
