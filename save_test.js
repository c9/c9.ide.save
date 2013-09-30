/*global describe it before after  =*/

require(["lib/architect/architect", "lib/chai/chai", "/vfs-root"], 
  function (architect, chai, baseProc) {
    var expect = chai.expect;
    
    document.body.appendChild(document.createElement("div"))
        .setAttribute("id", "saveStatus");
    
    architect.resolveConfig([
        {
            packagePath : "plugins/c9.core/c9",
            startdate   : new Date(),
            debug       : true,
            hosted      : true,
            local       : false,
            davPrefix   : "/"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        {
            packagePath: "plugins/c9.core/settings",
            testing: true
        },
        {
            packagePath  : "plugins/c9.ide.ui/ui",
            staticPrefix : "plugins/c9.ide.ui"
        },
        "plugins/c9.ide.editors/document",
        "plugins/c9.ide.editors/undomanager",
        {
            packagePath: "plugins/c9.ide.editors/editors",
            defaultEditor: "texteditor"
        },
        "plugins/c9.ide.editors/editor",
        "plugins/c9.ide.editors/tabmanager",
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        "plugins/c9.ide.ace/ace",
        "plugins/c9.ide.save/save",
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        {
            packagePath: "plugins/c9.fs/fs",
            baseProc: baseProc
        },
        "plugins/c9.fs/fs.cache.xml",
        
        // Mock plugins
        {
            consumes : ["apf", "ui"],
            provides : [
                "commands", "menus", "commands", "layout", "watcher", 
                "save", "anims", "tree", "preferences", "clipboard"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["tabManager", "save", "fs"],
            provides : [],
            setup    : main
        }
    ], function (err, config) {
        if (err) throw err;
        var app = architect.createApp(config);
        app.on("service", function(name, plugin){ plugin.name = name; });
    });
    
    function main(options, imports, register) {
        var tabs    = imports.tabManager;
        var fs      = imports.fs;
        var save    = imports.save;
        
        function countEvents(count, expected, done){
            if (count == expected) 
                done();
            else
                throw new Error("Wrong Event Count: "
                    + count + " of " + expected);
        }
        
        expect.html.setConstructor(function(tab){
            if (typeof tab == "object")
                return tab.pane.aml.getPage("editor::" + tab.editorType).$ext;
        });
        
        function changeTab(path, done){
            var tab = tabs.findTab(path);
            tabs.focusTab(tab);
            tab.document.undoManager.once("change", done);
            tab.document.editor.ace.insert("test");
            return tab;
        }
        
        var files = [];
        describe('save', function() {
            this.timeout(2000)
            
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                
                tabs.getPanes()[0].focus();
                
                files = ["/save1.txt", "/save2.txt", "/save3.txt"];
                
                bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                bar.$ext.style.position = "fixed";
                bar.$ext.style.left = "20px";
                bar.$ext.style.right = "20px";
                bar.$ext.style.bottom = "20px";
                bar.$ext.style.height = "150px";
      
                document.body.style.marginBottom = "180px";
                done();
            });
            after(function(done){
                files.forEach(function(path){
                    fs.unlink(path, function(){
                        done();
                    });
                });
            })
            
            describe("save", function(){
                before(function(done){
                    files.every(function(path, i){
                        fs.writeFile(path, path, function(){
                            tabs.openFile(path, function(){
                                if (path == files[2])
                                    done();
                            });
                        });
                        return i == 2 ? false : true;
                    });
                });
                
                it('should save a tab that is changed', function(done) {
                    var path  = "/save1.txt";
                    var count = 0;
                    
                    var c1 = function(){ count++; };
                    
                    save.on("beforeSave", c1);
                    save.on("afterSave", c1);
                    
                    var tab = changeTab(path, function(){
                        save.save(tab, null, function(err){
                            if (err) throw err;
                            expect(tab.document.changed).to.not.ok
                            
                            fs.readFile(path, function(err, data){
                                if (err) throw err;
                                expect(data).to.equal("test" + path);
                                expect(count).to.equal(2);
                                save.off("beforeSave", c1);
                                save.off("afterSave", c1);
                                done();
                            });
                        });
                    });
                });
                it('should queue saves when called sequentially', function(done) {
                    var tab = tabs.focussedTab;
                    var count = 0;
                    save.save(tab, null, function(err){
                        if (err) throw err;
                        expect(count).to.equal(0);
                        count++;
                    });
                    save.save(tab, null, function(err){
                        if (err) throw err;
                        expect(count).to.equal(1);
                        done();
                    });
                });
                it('should save a tab at a new path/filename', function(done) {
                    var tab = changeTab("/save2.txt", function(){
                        var path = "/save2b.txt";
                        files.push(path); //cleanup
                        
                        save.save(tab, { path: path }, function(err){
                            if (err) throw err;
                            
                            expect(tab.path).to.equal(path);
                            expect(tab.document.changed).to.not.ok
                            
                            fs.readFile(path, function(err, data){
                                if (err) throw err;
                                expect(data).to.equal("test/save2.txt");
                                
                                fs.unlink(path, function(){
                                    tab.close();
                                    expect(tabs.getTabs().indexOf(tab)).to.equal(-1);
                                    done();
                                });
                            });
                        });
                    });
                });
                it('should show the saveAs dialog when saving a newfile without path in the options', function(done) {
                    var path = "/shouldnotsave.txt";
                    files.push(path); //cleanup
                    
                    tabs.open({
                        active   : true,
                        path     : path,
                        document : {
                            value : "test",
                            meta  : {
                                newfile: true
                            }
                        }
                    }, function(err, tab){
                        save.save(tab, null, function(err){
                            expect(seen).to.ok;
                            tab.close();
                            done();
                        });
                    });
                    
                    var seen = false;
                    setTimeout(function(){
                        var win = save.getElement("winSaveAs");
                        expect(win.visible).to.ok;
                        expect(win.$int.querySelector("input").value).to.equal(path.substr(1));
                        seen = true;
                        win.hide();
                    }, 500);
                });
                it('should not show the saveAs dialog when saving a newfile with path in the options', function(done) {
                    var path = "/shouldnotsave.txt";
                    
                    tabs.open({
                        active   : true,
                        document : {
                            value : "test",
                            meta  : {
                                newfile: true
                            }
                        }
                    }, function(err, tab){
                        save.save(tab, { path: path}, function(err){
                            expect(tab.document.changed).not.ok
                            tab.close();
                            done();
                        });
                    });
                });
                it('should be triggered when closing a changed tab', function(done) {
                    var path = "/save3.txt";
                    var tab = changeTab(path, function(){
                        save.once("beforeWarn", function(){
                            setTimeout(function(){
                                save.once("afterSave", function(){
                                    fs.readFile(path, function(err, data){
                                        if (err) throw err;
                                        expect(data).to.equal("test" + path);
                                        done();
                                    });
                                });
                                
                                save.getElement("btnSaveYes").dispatchEvent("click");
                            }, 500)
                        });
                        
                        tab.close();
                    });
                });
                it('should not be triggered when closing an unchanged tab', function(done) {
                    var path  = "/save1.txt";
                    var tab = tabs.findTab(path);
                    save.once("beforeWarn", function(){
                        throw new Error();
                    });
                    done();
                });
                it('should not be triggered when closing a new empty file', function(done) {
                    tabs.open({
                        active   : true,
                        document : {
                            value : "",
                            meta  : {
                                newfile: true
                            }
                        }
                    }, function(err, tab){
                        save.once("beforeWarn", function(){
                            throw new Error();
                        });
                        
                        tab.close();
                        done();
                    });
                });
            });
            describe("saveAs", function(){
                before(function(done){
                    files.every(function(path, i){
                        fs.writeFile(path, path, function(){
                            tabs.openFile(path, function(){
                                if (path == files[2])
                                    done();
                            });
                        });
                        return i == 2 ? false : true;
                    });
                });
                after(function(done){
                    tabs.getTabs().forEach(function(tab){
                        tab.unload();
                    });
                    done();
                });
                
                it('should save a file under a new filename', function(done) {
                    var tab = tabs.focussedTab;
                    files.push("/save1b.txt");
                    save.saveAs(tab, function(err){
                        expect(err).to.not.ok
                        expect(seen).to.ok
                        done();
                    });
                    
                    var seen = false;
                    setTimeout(function(){
                        var win = save.getElement("winSaveAs");
                        expect(win.visible).to.ok;
                        seen = true;
                        win.$int.querySelector("input").value = "/save1b.txt";
                        save.getElement("btnSaveAsOK").dispatchEvent("click");
                    }, 500);
                });
                it('should trigger saveAs and then cancel it', function(done) {
                    var tab = tabs.focussedTab;
                    save.saveAs(tab, function(err){
                        expect(err).to.ok
                        expect(seen).to.ok
                        done();
                    });
                    
                    var seen = false;
                    setTimeout(function(){
                        var win = save.getElement("winSaveAs");
                        expect(win.visible).to.ok;
                        seen = true;
                        win.hide();
                    }, 500);
                });
            });
            describe("revertToSaved", function(){
                before(function(done){
                    files.every(function(path, i){
                        fs.writeFile(path, path, function(){
                            tabs.openFile(path, function(){
                                if (path == files[2])
                                    done();
                            });
                        });
                        return i == 2 ? false : true;
                    });
                });
                after(function(done){
                    tabs.getTabs().forEach(function(tab){
                        tab.unload();
                    });
                    done();
                });
                
                it('should revert a change tab', function(done) {
                    var tab = changeTab("/save1.txt", function(){
                        save.revertToSaved(tab, function(err){
                            expect(err).to.not.ok
                            expect(tab.document.changed).to.not.ok
                            expect(tab.document.value).to.equal("/save1.txt");
                            expect(tab.document.undoManager.length).to.equal(2);
                            expect(tab.document.undoManager.position).to.equal(1);
                            expect(tab.document.undoManager.isAtBookmark()).to.ok;
                            expect(tab.className.names.indexOf("loading")).to.equal(-1);
                            done();
                        });
                    });
                });
            });
            describe("saveAll", function(){
                before(function(done){
                    files.every(function(path, i){
                        fs.writeFile(path, path, function(){
                            tabs.openFile(path, function(){
                                if (path == files[2])
                                    done();
                            });
                        });
                        return i == 2 ? false : true;
                    });
                });
                after(function(done){
                    tabs.getTabs().forEach(function(tab){
                        tab.unload();
                    });
                    done();
                });
                
                it('should save all changed files', function(done) {
                    var page3 = tabs.findTab("/save3.txt");
                    var page1 = changeTab("/save1.txt", function(){
                        var page2 = changeTab("/save2.txt", function(){
                            expect(page1.document.changed).to.ok;
                            expect(page2.document.changed).to.ok;
                            expect(page3.document.changed).to.not.ok;
                            
                            save.saveAll(function(){
                                expect(page1.document.changed).to.not.ok;
                                expect(page2.document.changed).to.not.ok;
                                expect(page3.document.changed).to.not.ok;
                                done();
                            });
                        });
                    });
                });
            });
            describe("saveAllInteractive", function(){
                before(function(done){
                    files.every(function(path, i){
                        fs.writeFile(path, path, function(){
                            tabs.openFile(path, function(){
                                if (path == files[2])
                                    done();
                            });
                        });
                        return i == 2 ? false : true;
                    });
                });
                after(function(done){
                    tabs.getTabs().forEach(function(tab){
                        tab.unload();
                    });
                    done();
                });
                
                it('should be triggered when closing multiple pages that are changed', function(done) {
                    var page1 = changeTab("/save1.txt", function(){
                        var page2 = changeTab("/save2.txt", function(){
                            var page3 = changeTab("/save3.txt", function(){
                                var pages = [page1, page2, page3];
                                
                                save.saveAllInteractive(pages, function(result){
                                    expect(result).to.equal(save.YESTOALL);
                                    done();
                                });
                                
                                save.getElement("btnYesAll").dispatchEvent("click");
                            });
                        });
                    });
                });
            });
            if (!onload.remain){
                describe("unload()", function(){
                    it('should destroy all ui elements when it is unloaded', function(done) {
                        save.unload();
                        done();
                    });
                });
                
                //@todo Idea: show in the tabs whether the editor is running atm
                // @todo test fs integration
                
                after(function(done){
                    document.body.style.marginBottom = "";
                    tabs.unload();
                    done();
                });
            }
        });
        
        onload && onload();
    }
});