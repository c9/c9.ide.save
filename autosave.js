/*
 * Autosave Module for the Cloud9 IDE
 *
 * @author Sergi Mansilla <sergi@c9.io>
 * @copyright 2012, Ajax.org B.V.
 */
define(function(require, exports, module) {
    main.consumes = [
        "plugin", "c9", "settings", "ui", "layout", "tooltip",
        "anims", "menus", "tabs", "preferences", "save"
    ];
    main.provides = ["autosave"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var Plugin   = imports.plugin;
        var settings = imports.settings;
        var save     = imports.save;
        var tooltip  = imports.tooltip;
        var tabs     = imports.tabs;
        var prefs    = imports.preferences;
        // var stripws  = imports.stripws;
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        // var emit   = plugin.getEmitter();
        
        var INTERVAL       = 60000;
        var CHANGE_TIMEOUT = 500;
        
        var docChangeTimeout   = null;
        var btnSave, autosave, saveInterval;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            prefs.add({
                "General" : {
                    "General" : {
                        position : 50,
                        "Enable Auto-Save" : {
                            type     : "checkbox",
                            position : 1000,
                            path     : "user/general/@autosave"
                        }
                    }
                }
            }, plugin);
            
            settings.on("read", function(e){
                settings.setDefaults("user/general", [["autosave", "false"]]);
                autosave = settings.getBool("user/general/@autosave");
                transformButton();
            }, plugin);
    
            settings.on("user/general", function(e) {
                autosave = settings.getBool("user/general/@autosave");
                transformButton();
            }, plugin);
    
            // when we're back online we'll trigger an autosave if enabled
            c9.on("stateChange", function(e) {
                if (e.state & c9.STORAGE && !(e.last & c9.STORAGE))
                    check();
            }, plugin);
            
            save.getElement("btnSave", function(btn){
                btnSave = btn;
                transformButton();
            });
            
            tabs.on("pageCreate", function(e){
                var page = e.page;
                page.document.undoManager.on("change", function(e){
                    if (!autosave || !page.path)
                        return;
                    
                    clearTimeout(docChangeTimeout);
                    docChangeTimeout = setTimeout(function() {
                        // stripws.disable();
                        savePage(page);
                    }, CHANGE_TIMEOUT);
                }, plugin);
            }, plugin);
            
            tabs.on("pageDestroy", function(e){
                if (!e.page.path)
                    return;
                
                if (tabs.getPages().length == 1)
                    btnSave.hide();
        
                savePage(e.page);
            }, plugin);
            
            save.on("beforeWarn", function(e){
                if (autosave && !e.page.document.meta.newfile) {
                    savePage(e.page);
                    return false;
                }
            }, plugin);
        }
        
        function transformButton(){
            if (!btnSave) return;
            if (btnSave.autosave === autosave) return;
            
            if (autosave) {
                // Transform btnSave
                btnSave.setAttribute("caption", "");
                btnSave.setAttribute("margin", "0 20");
                btnSave.removeAttribute("tooltip");
                btnSave.removeAttribute("command");
                apf.setStyleClass(btnSave.$ext, "btnSave");
                
                tooltip.add(btnSave, {
                    message : "Changes to your file are automatically saved.<br />\
                        View all your changes through <a href='javascript:void(0)' \
                        onclick='require(\"ext/revisions/revisions\").toggle();' \
                        class='revisionsInfoLink'>the Revision History pane</a>. \
                        Rollback to a previous state, or make comparisons.",
                    width : "250px",
                    hideonclick : true
                });
            }
            else {
                
            }
            
            btnSave.autosave = autosave;
        }
        
        /***** Helpers *****/
    
        function check() {
            if (!autosave) return;
            
            var pages = tabs.getPages();
            for (var page, i = 0, l = pages.length; i < l; i++) {
                if ((page = pages[i]).document.changed && page.path)
                    savePage(page)
            }
        }
    
        function savePage(page, force) {
            if (!autosave) return;
            
            if (!c9.has(c9.STORAGE)) {
                save.setSavingState(page, "offline");
                return;
            }
            
            if (!force && (!page.path 
              || !page.document.changed
              || page.document.meta.newfile
              || page.document.meta.error))
                return;
    
            save.save(page, { silentsave: true, timeout: 1 }, function() {
                // stripws.enable();
            });
        }
    
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            autosave = settings.getBool("user/general/@autosave");
            transformButton();
            
        });
        plugin.on("disable", function(){
            autosave = false;
            transformButton();
        });
        plugin.on("unload", function(){
            if (saveInterval)
                clearInterval(saveInterval);
    
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         **/
        plugin.freezePublicAPI({ });
        
        register(null, {
            autosave: plugin
        });
    }
});