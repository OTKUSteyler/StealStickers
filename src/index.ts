/**
 * StealStickers — Kettu / Bunny Plugin
 *
 * Adds a "📥 Download Sticker" button to the MessageLongPressActionSheet
 * when long-pressing messages that contain stickers.
 *
 * Inspired by Stealmoji by Fierdetta
 * Built for Kettu/Bunny/Revenge
 */

import { findByProps, findByName } from "@vendetta/metro";
import { after } from "@vendetta/patcher";
import { ReactNative as RN } from "@vendetta/metro/common";
import { showToast } from "@vendetta/ui/toasts";

const { Platform, Linking } = RN;

let unpatches = [];

// ---------------------------------------------------------------------------
// Sticker info extraction
// ---------------------------------------------------------------------------

/**
 * Extract sticker data from a message
 */
function extractStickerInfo(message) {
    if (!message) return null;

    // Check message.stickerItems array (camelCase - the correct property!)
    if (message.stickerItems && Array.isArray(message.stickerItems) && message.stickerItems.length > 0) {
        const sticker = message.stickerItems[0];
        return buildStickerData(sticker);
    }

    // Check message.sticker_items array (snake_case - alternative)
    if (message.sticker_items && Array.isArray(message.sticker_items) && message.sticker_items.length > 0) {
        const sticker = message.sticker_items[0];
        return buildStickerData(sticker);
    }

    // Check message.stickers array (fallback)
    if (message.stickers && Array.isArray(message.stickers) && message.stickers.length > 0) {
        const sticker = message.stickers[0];
        return buildStickerData(sticker);
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
        default: ext = "png"; break;  // Default to PNG
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
            showToast(`Downloaded ${stickerInfo.name}! 📥`, "success");
            return;
        }

        if (fileManager?.saveFile) {
            await fileManager.saveFile(stickerInfo.url, filename);
            showToast(`Saved ${stickerInfo.name}! 📥`, "success");
            return;
        }

        // Fallback: Open in browser/external app
        if (Linking) {
            await Linking.openURL(stickerInfo.url);
            showToast("Opened sticker URL 🌐", "info");
        } else {
            showToast("Download not available ❌", "error");
        }

    } catch (e) {
        console.error("[StealStickers] Download failed:", e);
        showToast(`Failed: ${e.message}`, "error");
    }
}

// ---------------------------------------------------------------------------
// ActionSheet patching
// ---------------------------------------------------------------------------

/**
 * Find and patch the MessageLongPressActionSheet
 */
function patchActionSheet() {
    try {
        // Find the ActionSheet component by name (shown in your screenshot)
        const ActionSheet = findByName("MessageLongPressActionSheet", false);
        
        if (!ActionSheet) {
            console.warn("[StealStickers] MessageLongPressActionSheet not found");
            return;
        }

        // Patch the component
        const unpatch = after("type", ActionSheet, (args, res) => {
            try {
                const props = args[0];
                const message = props?.message;
                
                if (!message) return res;

                const stickerInfo = extractStickerInfo(message);
                if (!stickerInfo) return res; // No sticker in this message

                // Build our download action
                const downloadAction = {
                    key: "steal-sticker",
                    icon: "📥", // Some ActionSheets support icon prop
                    label: "Download Sticker",
                    onPress: () => {
                        downloadSticker(stickerInfo);
                    }
                };

                // Inject into the ActionSheet options
                // The structure from your screenshot shows options in an array
                if (res?.props) {
                    // Try direct options array
                    if (Array.isArray(res.props.options)) {
                        res.props.options.push(downloadAction);
                        return res;
                    }

                    // Try children array
                    if (res.props.children) {
                        if (Array.isArray(res.props.children)) {
                            // Look for options in children
                            for (const child of res.props.children) {
                                if (child?.props?.options && Array.isArray(child.props.options)) {
                                    child.props.options.push(downloadAction);
                                    return res;
                                }
                            }
                            // Add as new child if no options found
                            res.props.children.push(downloadAction);
                        } else {
                            res.props.children = [res.props.children, downloadAction];
                        }
                    } else {
                        res.props.children = downloadAction;
                    }
                }

            } catch (e) {
                console.error("[StealStickers] Error in ActionSheet patch:", e);
            }
            
            return res;
        });

        unpatches.push(unpatch);
        console.log("[StealStickers] Patched MessageLongPressActionSheet");
        
    } catch (e) {
        console.error("[StealStickers] Failed to patch ActionSheet:", e);
    }
}

/**
 * Alternative: Patch the action builder if ActionSheet patch doesn't work
 */
function patchActionBuilder() {
    try {
        // Find the module that builds message actions
        const actionsModule = findByProps("getMessageActions", false) ||
                             findByProps("buildMessageActions", false);
        
        if (!actionsModule) {
            console.warn("[StealStickers] Actions module not found");
            return;
        }

        const target = actionsModule.getMessageActions || 
                      actionsModule.buildMessageActions ||
                      actionsModule.default;

        if (typeof target !== "function") {
            console.warn("[StealStickers] No patchable function in actions module");
            return;
        }

        const unpatch = after("getMessageActions", actionsModule, (args, ret) => {
            try {
                const message = args[0];
                const stickerInfo = extractStickerInfo(message);
                
                if (!stickerInfo) return ret;

                const downloadAction = {
                    key: "steal-sticker",
                    label: "📥 Download Sticker",
                    onPress: () => downloadSticker(stickerInfo)
                };

                if (Array.isArray(ret)) {
                    ret.push(downloadAction);
                }

            } catch (e) {
                console.error("[StealStickers] Error in action builder patch:", e);
            }
            
            return ret;
        });

        unpatches.push(unpatch);
        console.log("[StealStickers] Patched action builder");
        
    } catch (e) {
        console.error("[StealStickers] Failed to patch action builder:", e);
    }
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

export default {
    onLoad: () => {
        try {
            // Try both patching strategies
            patchActionSheet();
            patchActionBuilder();

            if (unpatches.length === 0) {
                console.warn(
                    "[StealStickers] No patches applied. " +
                    "The plugin may not work until Discord loads the ActionSheet."
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
