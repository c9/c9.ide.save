/*global winConfirm, btnConfirmOk */

/**
 * Save Module for the Cloud9 IDE
 *
 * @copyright 2010-2012, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */
define(function(require, exports, module) {
    main.consumes = [
        "Plugin", "c9", "util", "fs", "layout", "commands", "tree",
        "menus", "settings", "ui", "tabManager", "fs.cache.xml"
    ];
    main.provides = ["save"];
    return main;

    function main(options, imports, register) {
        var c9       = imports.c9;
        var util     = imports.util;
        var Plugin   = imports.Plugin;
        var settings = imports.settings;
        var ui       = imports.ui;
        var commands = imports.commands;
        var menus    = imports.menus;
        var fs       = imports.fs;
        var layout   = imports.layout;
        var tabs     = imports.tabManager;
        var tree     = imports.tree;
        var fsCache  = imports["fs.cache.xml"];
        
        var css           = require("text!./save.css");
        var saveAsMarkup  = require("text!./saveas.xml");
        var confirmMarkup = require("text!./confirm.xml");
        
        /***** Initialization *****/
        
        var plugin = new Plugin("Ajax.org", main.consumes);
        var emit   = plugin.getEmitter();
        
        var btnSave, winCloseConfirm, btnYesAll, btnNoAll, btnSaveAsCancel;
        var btnSaveCancel, btnSaveYes, btnSaveNo, saveStatus, btnSaveAsOK;
        var trSaveAs, winSaveAs, fileDesc, txtSaveAs, lblPath, btnCreateFolder;
        var chkShowFiles;
        
        var saveBuffer = {};
        
        var SAVING   = 0;
        var SAVED    = 1;
        var OFFLINE  = 2;
        
        var YESTOALL = -2;
        var NOTOALL  = -1;
        var YES      = 2;
        var NO       = 1;
        var CANCEL   = 0;
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            function available(editor){
                return !!editor && (c9.status & c9.STORAGE)
                    && (!tabs.focussedTab
                    || typeof tabs.focussedTab.path == "string");
            }
            
            // This prevents the native save dialog to popup while being offline
            commands.addCommand({
                bindKey : {mac: "Command-S", win: "Ctrl-S"},
                exec    : function(){}
            }, plugin);
            commands.addCommand({
                name    : "save",
                hint    : "save the currently active file to disk",
                bindKey : {mac: "Command-S", win: "Ctrl-S"},
                isAvailable : available,
                exec: function () {
                    save(null, null, function(){});
                }
            }, plugin);
    
            commands.addCommand({
                name    : "saveas",
                hint    : "save the file to disk with a different filename",
                bindKey : {mac: "Command-Shift-S", win: "Ctrl-Shift-S"},
                isAvailable : available,
                exec: function () {
                    saveAs();
                }
            }, plugin);
    
            commands.addCommand({
                name    : "saveall",
                hint    : "save all unsaved files",
                isAvailable : available,
                exec: function () {
                    saveAll(function(){});
                }
            }, plugin);
    
            commands.addCommand({
                name    : "reverttosaved",
                hint    : "downgrade the currently active file to the last saved version",
                bindKey : { mac: "Ctrl-Shift-Q", win: "Ctrl-Shift-Q" },
                isAvailable : available,
                exec: function () {
                    revertToSaved(null, function(){});
                }
            }, plugin);
    
            tabs.on("tabBeforeClose", function(e) {
                var tab        = e.tab;
                var undoManager = tab.document.undoManager;
                
                // Won't save documents that don't support paths
                // Use path = "" to trigger Save As Dialog
                if (typeof tab.path !== "string") 
                    return; 
                
                // There's nothing to save
                if (undoManager.isAtBookmark())
                    return;
                
                // Still no changes
                if (!tab.document.changed)
                    return;
                
                // Already checked, now just closing - volatile attribute
                if (tab.document.meta.$ignoreSave)
                    return;

                // Custom tab no-prompt-saving - persistent attribute
                if (tab.document.meta.ignoreSave)
                    return;

                // Won't save new file that is empty
                if (tab.document.meta.newfile && !tab.document.value)
                    return;
                
                // For autosave and other plugins
                if (emit("beforeWarn", { tab : tab }) === false)
                    return;

                drawConfirm();

                // Activate tab to be warned for
                tabs.activateTab(tab);

                winCloseConfirm.tab = tab;
                winCloseConfirm.all  = CANCEL;
                winCloseConfirm.show();

                fileDesc.replaceMarkup("<div><h3>Save " 
                    + ui.escapeXML(tab.path) + "?</h3><div>This file has "
                    + "unsaved changes. Your changes will be lost if you don't "
                    + "save them.</div></div>", { "noLoadingMsg": false });

                winCloseConfirm.on("hide", function onHide(){
                    if (winCloseConfirm.all != CANCEL) {
                        function done(){
                            var tab = winCloseConfirm.tab;
                            if (!tab) return;

                            delete winCloseConfirm.tab;

                            emit("dialogClose", { tab: tab });
                            
                            tab.document.meta.$ignoreSave = true;
                            tab.close();
                            delete tab.document.meta.$ignoreSave;
                        };

                        if (winCloseConfirm.all == YES)
                            save(winCloseConfirm.tab, {silentsave: true}, done);
                        else
                            done();
                    }
                    else
                        emit("dialogCancel", { tab: tab });

                    winCloseConfirm.off("hide", onHide);
                });

                btnYesAll.hide();
                btnNoAll.hide();

                return false;
            }, plugin);
            
            saveStatus = document.getElementById("saveStatus");
    
            var toolbar = layout.findParent({name: "save"});
            btnSave = ui.insertByIndex(toolbar, new ui.button({
                id       : "btnSave",
                caption  : "Save",
                tooltip  : "Save",
                disabled : "true",
                skin     : "c9-toolbarbutton-glossy",
                command  : "save"
            }), 1000, plugin);
    
            menus.addItemByPath("File/Save", new ui.item({
                command : "save"
            }), 1000, plugin);

            menus.addItemByPath("File/Save As...", new ui.item({
                command : "saveas"
            }), 1100, plugin);

            menus.addItemByPath("File/Save All", new ui.item({
                command : "saveall"
            }), 1200, plugin);

            menus.addItemByPath("File/Revert to Saved", new ui.item({
                command : "reverttosaved"
            }), 700, plugin);
            
            tabs.on("focus", function(e){
                btnSave.setAttribute("disabled", !available(true));
            });
            tabs.on("tabDestroy", function(e){
                if (e.last)
                    btnSave.setAttribute("disabled", true);
            });
            
            c9.on("stateChange", function(e){
                if (e.state & c9.STORAGE) 
                    plugin.enable();
                else 
                    plugin.disable();
            });
        }
        
        var drawn = 0;
        function drawConfirm(){
            if (drawn & 1) return;
            drawn = drawn | 1;
            
            ui.insertMarkup(null, confirmMarkup, plugin);
            
            winCloseConfirm = plugin.getElement("winCloseConfirm");
            btnYesAll       = plugin.getElement("btnYesAll");
            btnNoAll        = plugin.getElement("btnNoAll");
            btnSaveYes      = plugin.getElement("btnSaveYes");
            btnSaveNo       = plugin.getElement("btnSaveNo");
            btnSaveCancel   = plugin.getElement("btnSaveCancel");
            fileDesc        = plugin.getElement("fileDesc");
            
            btnYesAll.on("click", function(){
                winCloseConfirm.all = YESTOALL;
                winCloseConfirm.hide();
            });
            btnNoAll.on("click", function(){
                winCloseConfirm.all = NOTOALL;
                winCloseConfirm.hide();
            });
            btnSaveYes.on("click", function(){
                winCloseConfirm.all = YES;
                winCloseConfirm.hide();
            });
            btnSaveNo.on("click", function(){
                winCloseConfirm.all = NO;
                winCloseConfirm.hide();
            });
            btnSaveCancel.on("click", function(){
                winCloseConfirm.all = CANCEL;
                winCloseConfirm.hide();
            });
            
            winCloseConfirm.on("keydown", function(){
                if (event.keyCode == 27)
                    btnSaveCancel.dispatchEvent('click', {htmlEvent: {}});
                if (event.keyCode == 89)
                    btnSaveYes.dispatchEvent('click', {htmlEvent: {}});
                else if (event.keyCode == 78)
                    btnSaveNo.dispatchEvent('click', {htmlEvent: {}});
            })
            
            emit("drawConfirm");
        }
        
        function drawSaveAs(){
            if (drawn & 2) return;
            drawn = drawn | 2;
            
            // Import the CSS
            ui.insertCss(css, plugin);
            
            // Create UI elements
            ui.insertMarkup(null, saveAsMarkup, plugin);
        
            winSaveAs       = plugin.getElement("winSaveAs");
            trSaveAs        = plugin.getElement("trSaveAs");
            btnSaveAsCancel = plugin.getElement("btnSaveAsCancel");
            btnSaveAsOK     = plugin.getElement("btnSaveAsOK");
            lblPath         = plugin.getElement("lblPath");
            txtSaveAs       = plugin.getElement("txtSaveAs");
            btnCreateFolder = plugin.getElement("btnCreateFolder");
            chkShowFiles    = plugin.getElement("chkShowFiles");
            
            chkShowFiles.on("onafterchange", function(){
                if (chkShowFiles.checked)
                    ui.setStyleClass(trSaveAs.$ext, "", ["hidefiles"]);
                else
                    ui.setStyleClass(trSaveAs.$ext, "hidefiles");
            });
            btnCreateFolder.on("click", function(){ 
                tree.createFolder("New Folder", false, function(){}, trSaveAs);
            });
            btnSaveAsCancel.on("click", function(){ winSaveAs.hide() });
            btnSaveAsOK.on("click", function(){ confirmSaveAs(winSaveAs.tab) });
            txtSaveAs.on("keydown", function(e){ 
                if (e.keyCode == 13)
                    confirmSaveAs(winSaveAs.tab);
            });
    
            winSaveAs.on("show", function(){
                expandTree();
            });
            // winSaveAs.on("hide", function(){
            //     if (winSaveAs.tab) {
            //         winSaveAs.tab.unload();
            //         winSaveAs.tab.document.undoManager.reset();
            //         delete winSaveAs.tab;
            //     }
            // });
            
            function chooseSaveAsFolder(folder) {
                var fooPath = folder.getAttribute("path");
                if (folder.getAttribute("type") != "folder" 
                  && folder.tagName != "folder") {
                    var fooPath = fooPath.split("/");
                    txtSaveAs.setValue(fooPath.pop());
                    fooPath = fooPath.join("/");
                }
                lblPath.setProperty('caption', fooPath);
            }
        
            trSaveAs.on("afterselect", function(){
                chooseSaveAsFolder(trSaveAs.selected);
            });
            trSaveAs.on("afterchoose", function(){
                chooseSaveAsFolder(trSaveAs.selected)
            });
    
            // Decorate tree with fs actions (copied from tree - should this be a lib?)
            trSaveAs.setAttribute("model", fsCache.model);
            
            // Begin Hack to make tree work well with fsCache managing the model
            trSaveAs.$setLoadStatus = function(xmlNode, state, remove){
                // state: loading, loaded, potential, null
                var to = remove ? "" : state;
                if (xmlNode.getAttribute("status") != to) {
                    // Carefully assuming that a change to potential, 
                    // doesnt require a UI. Needed for preventing recursion
                    // when delete fails in an expanded tree
                    if (to == "potential")
                        xmlNode.setAttribute("status", to)
                    else
                        ui.xmldb.setAttribute(xmlNode, "status", to)
                }
            };
        
            trSaveAs.$hasLoadStatus = function(xmlNode, state, unique){
                if (!xmlNode)
                    return false;
                return xmlNode.getAttribute("status") == state;
            };
            // End Hack
            
            // Rename
            trSaveAs.on("beforerename", function(e){
                if (!c9.has(c9.STORAGE))
                    return false;
    
                if (trSaveAs.$model.data.firstChild == trSaveAs.selected) {
                    util.alert(
                        "Cannot rename project folder",
                        "Unable to rename to project folder",
                        "The project folder name is related to the url of your project and cannot be renamed here."
                    );
                    return false;
                }
                
                var node = e.args[0];
                var name = e.args[1];
                
                // Returning false from this function will cancel the rename. We do this
                // when the name to which the file is to be renamed contains invalid
                // characters
                var match = name.match(/^(?:\w|[.])(?:\w|[ .\-])*$/);
                if (!match || match[0] != name) {
                    util.alert(
                        "Invalid filename",
                        "Unable to rename to " + name,
                        "Names are only allowed alfanumeric characters, space, "
                        + "-, _ and . Use the terminal to rename to alternate names."
                    );
                    return false;
                }
                
                // check for a path with the same name, which is not allowed to rename to:
                var path = node.getAttribute("path"),
                    newpath = path.replace(/^(.*\/)[^\/]+$/, "$1" + name).toLowerCase(); //@todo check if lowercase isn't wrong
    
                var list = fsCache.findNodes(newpath);
                if (list.length > (list.indexOf(node) > -1 ? 1 : 0)) {
                    util.alert("Error", "Unable to Rename",
                        "That name is already taken. Please choose a different name.");
                    trSaveAs.getActionTracker().undo();
                    return false;
                }
                
                fs.rename(path, newpath, function(err, success) { });
                
                return false;
            }, plugin);
            
            // Remove
            trSaveAs.on("beforeremove", function(e){
                if (!c9.has(c9.STORAGE))
                    return false;
                
                var selection = trSaveAs.getSelection();
                if (selection.indexOf(fsCache.model.data.firstChild) > -1) {
                    util.alert(
                        "Cannot remove project folder",
                        "Unable to remove to project folder",
                        "The project folder can not be deleted. To delete this project go to the dashboard."
                    );
                    return false;
                }
                
                return util.removeInteractive(selection, function(file){
                    if (file.tagName == "folder")
                        fs.rmdir(file.getAttribute("path"), {recursive: true}, function(){});
                    else
                        fs.rmfile(file.getAttribute("path"), function(){});
                });
            });
            
            // Insert
            trSaveAs.on("beforeinsert", function(e){
                var xmlNode = e.xmlNode;
                fs.readdir(xmlNode.getAttribute("path"), function(err){
                    if (err) return;

                    expand(xmlNode);
                });
                return false;
            })
        
            emit("drawSaveas");
        }
        
        /***** Methods *****/
        
        function revertToSaved(tab, callback){
            tabs.reload(tab, callback);
        }
    
        function saveAll(callback) {
            var count = 0;
            tabs.getTabs().forEach(function (tab) {
                if (typeof tab.path != "string")
                    return;
                
                if (tab.document.undoManager.isAtBookmark())
                    return;
                    
                count++;
                save(tab, null, function(err){
                    if (--count === 0 || err) {
                        callback(err);
                        count = 0;
                    }
                });
            });
            
            if (!count) callback();
        }
    
        function saveAllInteractive(pages, callback){
            drawConfirm();
    
            winCloseConfirm.all = NO;
            
            var total = pages.length, counter = 0;
            ui.asyncForEach(pages, function(tab, next) {
                if (!tab.document.undoManager.isAtBookmark()) {
                    if (winCloseConfirm.all == YESTOALL)
                        save(tab, null, function(){});
    
                    if (winCloseConfirm.all < 1) // YESTOALL, NOTOALL, CANCEL
                        return next();
    
                    // Activate tab
                    tabs.activateTab(tab);
                    
                    fileDesc.replaceMarkup("<div><h3>Save " 
                        + ui.escapeXML(tab.path) + "?</h3><div>This file has "
                        + "unsaved changes. Your changes will be lost if you don't "
                        + "save them.</div></div>", { "noLoadingMsg": false });
                    
                    winCloseConfirm.tab = tab;
                    winCloseConfirm.show();
                    winCloseConfirm.on("hide", function onHide(){
                        if (Math.abs(winCloseConfirm.all) == YES)
                            save(tab, null, function(){});
    
                        winCloseConfirm.off("hide", onHide);
                        next();
                    });
    
                    btnYesAll.setProperty("visible", counter < total - 1);
                    btnNoAll.setProperty("visible", counter < total - 1);
                }
                else
                    next();
                    
                counter++;
            },
            function() {
                callback(winCloseConfirm.all);
            });
        }
    
        function ideIsOfflineMessage() {
            layout.showError("Failed to save file. Please check your connection. "
                + "When your connection has been restored you can try to save the file again.");
        }
        
        // `silentsave` indicates whether the saving of the file is forced by the user or not.
        function save(tab, options, callback) {
            if (!tab && !(tab = tabs.focussedTab))
                return;
    
            // Optional callback, against code, but allowing for now
            if (!options)
                options = {};
    
            var doc     = tab.document;
            var path    = options.path || tab.path;
            
            // If document is unloaded return
            if (!doc.loaded)
                return;
    
            if (emit("beforeSave", { 
                path     : path,
                document : doc,
                options  : options
            }) === false)
                return;
    
            // Use the save as flow for files that don't have a path yet
            if (!options.path && (doc.meta.newfile || !tab.path)){
                saveAs(tab, callback);
                return;
            }
    
            // IF we're offline show a message notifying the user
            if (!c9.has(c9.STORAGE))
                return ideIsOfflineMessage();
    
            // Check if we're already saving!
            if (!options.force) {
                if (saveBuffer[path]) {
                    saveBuffer[path].stack.push([tab, options, callback]);
                    return;
                }
                saveBuffer[path] = {stack: []};
            }
            
            setSavingState(tab, "saving");
    
            var bookmark = doc.undoManager.position;
            
            var fnProgress = progress.bind(tab);
            fs.writeFile(path, doc.value, function(err){
                if (err) {
                    if (!options.silentsave) {
                        layout.showError("Failed to save document. "
                            + "Please see if your internet connection is available and try again. "
                            + err.message
                        );
                    }
                    setSavingState(tab, "offline");
                }
                else {
                    delete doc.meta.newfile;
                    doc.undoManager.bookmark(bookmark);
                    
                    if (options.path)
                        tab.path = options.path;
                    
                    setSavingState(tab, "saved", options.timeout);
                    settings.save();
                }
                
                emit("afterSave", { 
                    path     : path,
                    document : doc, 
                    err      : err, 
                    options  : options 
                });
                
                callback(err);
                
                fnProgress({ complete: true });
                fs.off("progress.upload", fnProgress);
                
                checkBuffer(path);
            });
            fs.on("progressUpload", fnProgress);
    
            return false;
        }
        
        function progress(e){
            e.upload = true;
            this.document.progress(e)
        }
        
        function checkBuffer(path){
            if (saveBuffer[path]) {
                var next = saveBuffer[path].stack.shift();
                if (next) {
                    (next[1] || (next[1] = {})).force = true;
                    save.apply(window, next);
                }
                else
                    delete saveBuffer[path];
            }
        }
    
        function saveAs(tab, callback){
            if (!tab && !(tab = tabs.focussedTab))
                return;
    
            if (typeof tab.path != "string")
                return;
    
            drawSaveAs();
    
            txtSaveAs.setValue(fs.getFilename(tab.path));
            winSaveAs.page = tab;
            winSaveAs.show();
            
            // HACK: setProperty doesn't immediately reflect the UI state - needs to be delayed
            setTimeout(function () {
                lblPath.setProperty("caption", fs.getParentPath(tab.path) + "/");
            });

            winSaveAs.on("hide", function listen(){
                if (winSaveAs.callback) {
                    var err = new Error("User Cancelled Save");
                    err.code = "EUSERCANCEL";
                    winSaveAs.callback(err);
                }
                winSaveAs.off("hide", listen);
            });
            
            winSaveAs.callback = callback;
        }
    
        // Called by the UI 'confirm' button in winSaveAs.
        function confirmSaveAs(tab) {
            if (!tab)
                return;
            
            var path    = tab.path;
            var doc     = tab.document;
            var newPath = lblPath.getProperty("caption") + txtSaveAs.getValue();
    
            var isReplace = false;
            
            // check if we're already saving!
            if (saveBuffer[path]) {
                saveBuffer[path].stack.push([tab]);
                return;
            }
    
            function doSave() {
                var callback = winSaveAs.callback;
                delete winSaveAs.callback;
                
                winSaveAs.hide();
                save(tab, { path: newPath, replace: isReplace }, function(){});
    
                if (window.winConfirm) {
                    winConfirm.hide();
    
                    if (window.btnConfirmOk && btnConfirmOk.caption == "Yes")
                        btnConfirmOk.setCaption("Ok");
                }
                
                if (callback)
                    callback();
            };
    
            function doCancel() {
                if (window.winConfirm && btnConfirmOk.caption == "Yes")
                    btnConfirmOk.setCaption("Ok");
            };
            
            if (path !== newPath || doc.meta.newfile) {
                fs.exists(newPath, function (exists, stat) {
                    if (exists) {
                        if (stat 
                          && (/(directory|folder)$/.test(stat.mime) || stat.link 
                          && /(directory|folder)$/.test(stat.linkStat.mime))) {
                            var node = fsCache.findNode(newPath);
                            trSaveAs.select(node);
                            if (trSaveAs.selected == node) {
                                txtSaveAs.setValue("");
                                expand(node);
                            }
                            return;
                        }
                        
                        var name = newPath.match(/\/([^\/]*)$/)[1];
    
                        isReplace = true;
                        util.confirm(
                            "A file with this name already exists",
                            "\"" + name + "\" already exists, do you want to replace it?",
                            "A file with the same name already exists at this location." +
                            "Selecting Yes will overwrite the existing document.",
                            doSave,
                            doCancel);
                        btnConfirmOk.setCaption("Yes");
                    }
                    else {
                        doSave();
                    }
                });
            }
            else {
                doSave();
            }
        }
        
        function expand(xmlNode){
            var htmlNode = ui.xmldb.getHtmlNode(xmlNode, trSaveAs);
            if (htmlNode)
                trSaveAs.slideOpen(null, xmlNode, true);
        }
        
        function expandTree(){
            function expand(){
                var tab = tabs.focussedTab;
                if (!tab) return;
                
                // var path  = tab.path
                // var isNew = tab.document.meta.newfile
                
                trSaveAs.slideOpen(null, fsCache.findNode("/"));
            }
    
            if (fsCache.findNode("/").childNodes.length)
                expand();
            else
                trSaveAs.on("afterload", expand);
        }
    
        var stateTimer = null, pageTimers = {};
        function setSavingState(tab, state, timeout) {
            clearTimeout(stateTimer);
            clearTimeout(pageTimers[tab.name]);
            
            tab.className.remove("saving", "saved", "error");
            tab.document.meta.saving = state;
            
            if (state == "saving") {
                btnSave.show();
        
                ui.setStyleClass(btnSave.$ext, "saving", ["saved", "error"]);
                ui.setStyleClass(saveStatus, "saving", ["saved", "error"]);
                saveStatus.style.display = "block";
                btnSave.currentState = SAVING;
                btnSave.setCaption("Saving");
                tab.className.add("saving");
                
                // Error if file isn't saved after 30 seconds
                // @TODO Rewrite this to check the progress event of fs
                // stateTimer = setTimeout(function(){
                //     setSavingState(tab, "offline");
                //     checkBuffer(tab.path);
                // }, 60000);
            }
            else if (state == "saved") {
                btnSave.show();
        
                // Remove possible error state on a succesful save
                delete tab.document.meta.error;
        
                ui.setStyleClass(btnSave.$ext, "saved", ["saving", "error"]);
                ui.setStyleClass(saveStatus, "saved", ["saving", "error"]);
                saveStatus.style.display = "block";
                btnSave.currentState = SAVED;
                btnSave.setCaption("Changes saved");
                tab.className.add("saved");
        
                stateTimer = setTimeout(function () {
                    if (btnSave.currentState === SAVED)
                        btnSave.hide();
                }, 4000);
                
                pageTimers[tab.name] = setTimeout(function () {
                    if (btnSave.currentState === SAVED) {
                        saveStatus.style.display = "none";
                        tab.className.remove("saved");
                    }
                    delete tab.document.meta.saving;
                    emit("page.savingstate", {page: tab});
                }, timeout || 500);
            }
            else if (state == "offline") {
                btnSave.show();
        
                // don't blink!
                ui.setStyleClass(btnSave.$ext, "saved");
                ui.setStyleClass(btnSave.$ext, "error", ["saving"]);
                ui.setStyleClass(saveStatus, "error", ["saving"]);
                saveStatus.style.display = "block";
        
                btnSave.currentState = OFFLINE;
                btnSave.setCaption("Not saved");
                tab.className.add("error");
            }

            emit("tabSavingState", { tab: tab });
        }
        
        /***** Lifecycle *****/
        
        plugin.on("load", function(){
            load();
        });
        plugin.on("enable", function(){
            winSaveAs && winSaveAs.enable();
            btnSave && btnSave.enable();
            btnYesAll && btnYesAll.enable();
            btnSaveYes && btnSaveYes.enable();
        });
        plugin.on("disable", function(){
            winSaveAs && winSaveAs.disable();
            btnSave && btnSave.disable();
            btnYesAll && btnYesAll.disable();
            btnSaveYes && btnSaveYes.disable();
            
            // Set all buffers that are saving to an error state
            for (var path in saveBuffer) {
                var tab = tabs.findTab(path);
                if (tab) 
                    setSavingState(tab, "offline");
            }

            // Clear the save buffers to enable easy saving of all files
            saveBuffer = {};
        });
        plugin.on("unload", function(){
            loaded = false;
            drawn  = 0;
        });
        
        /***** Register and define API *****/
        
        /**
         * Save handling in Cloud9
         * @event beforeWarn Fires before the save warning is shown. The save 
         *     warning occurs when the document of a tab is in the changed 
         *     state and the tab is closed. You can test for the changed state
         *     via `tab.document.changed`.
         *   cancellable: true
         * @param {Object} e
         *     {Tab} tab
         **/
        plugin.freezePublicAPI({
            SAVING    : SAVING,
            SAVED     : SAVED,
            OFFLINE   : OFFLINE,
            
            /**
             * @property {Constant} the user clicked the "Yes To All" button.
             */
            YESTOALL  : YESTOALL,
            /**
             * @property {Constant} the user clicked the "No To All" button.
             */
            NOTOALL   : NOTOALL,
            /**
             * @property {Constant} the user clicked the "Yes" button.
             */
            YES       : YES,
            /**
             * @property {Constant} the user clicked the "No" button.
             */
            NO        : NO,
            /**
             * @property {Constant} the user clicked the "Cancel" button.
             */
            CANCEL    : CANCEL,
            
            /**
             * Saves the contents of a tab to disk using `fs.writeFile`
             * @param {Tab} tab the pane tab to save
             * @param {Object} options
             * @param {Object} e
             *     {Boolean} force      whether to save no matter what conditions
             *     {String}  path       the new path of the file (otherwise tab.path is used)
             *     {Boolean} silentsave whether to show an error message in the UI when a save fails
             *     {Number}  timeout    the time any success state is shown in the UI
             * @param callback(err) {Function} called after the file is saved or had an error
             * @event beforeSave Fires before the file is being saved
             *   cancellable: true
             * @param {Object} e
             *     {String}   path
             *     {Document} document
             *     {Object}   options
             * @event afterSave Fires after a file is saved or had an error
             * @param {Object} e
             *     {String}   path
             *     {Error}    err
             *     {Document} document
             *     {Object}   options
             */
            save : save,
            
            /**
             * Saves a file and allows the user to choose the path
             * @param {Tab}     tab          the pane tab to save
             * @param {Function} callback(err) called after the file is saved or had an error
             */
            saveAs : saveAs,
            
            /**
             * Reverts the value of a tab / document back to the value that is on disk
             * @param {Tab} tab the pane tab to save
             */
            revertToSaved : revertToSaved,
            
            /**
             * Saves all changed pages
             * @param {Function} callback(err) called after the files are saved or had an error
             */
            saveAll : saveAll,
            
            /**
             * Saves a set of pages by asking the user for confirmation
             * @param {Array}    pages                 the pages to save
             * @param {Function} callback(err, result) called each time the user 
             *   clicks a button in the confirm dialog. The `result` variable
             *   is set with one of the following constants:
             *      save.YESTOALL
             *      save.NOTOALL
             *      save.YES
             *      save.NO
             *      save.CANCEL
             */
            saveAllInteractive : saveAllInteractive,
            
            /**
             * 
             */
            setSavingState : setSavingState
        });
        
        register(null, {
            save: plugin
        });
    }
});