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
            smithIo     : "{\"prefix\":\"/smith.io/server\"}",
            hosted      : true,
            local       : false,
            davPrefix   : "/"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/events",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        "plugins/c9.ide.ui/tooltip",
        "plugins/c9.core/settings",
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
        "plugins/c9.ide.editors/tabs",
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        "plugins/c9.ide.ace/ace",
        "plugins/c9.ide.save/save",
        "plugins/c9.ide.save/autosave",
        {
            packagePath: "plugins/c9.vfs.client/vfs_client",
            smithIo     : {
                "prefix": "/smith.io/server"
            }
        },
        "plugins/c9.ide.auth/auth",
        {
            packagePath: "plugins/c9.fs/fs",
            baseProc: baseProc
        },
        "plugins/c9.fs/fs.cache.xml",
        
        // Mock plugins
        {
            consumes : ["emitter", "apf", "ui"],
            provides : [
                "commands", "menus", "commands", "layout", "watcher", 
                "save", "anims", "tree", "preferences", "clipboard"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["tabs", "save", "fs", "autosave"],
            provides : [],
            setup    : main
        }
    ], function (err, config) {
        if (err) throw err;
        var app = architect.createApp(config);
        app.on("service", function(name, plugin){ plugin.name = name; });
    });
    
    function main(options, imports, register) {
        var tabs     = imports.tabs;
        var fs       = imports.fs;
        var save     = imports.save;
        var autosave = imports.autosave;
        
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
        
        function changePage(path, done){
            var tab = tabs.findPage(path);
            tabs.focusPage(tab);
            tab.document.undoManager.once("change", done);
            tab.document.editor.ace.insert("test");
            return tab;
        }
        
        var files = [];
        describe('autosave', function() {
            this.timeout(2000)
            
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);
                
                tabs.getPanes()[0].focus();
                
                var path = "/autosave1.txt";
                fs.writeFile(path, path, function(){
                    tabs.openFile(path, function(){
                        done();
                    });
                });
                
                bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                bar.$ext.style.position = "fixed";
                bar.$ext.style.left = "20px";
                bar.$ext.style.right = "20px";
                bar.$ext.style.bottom = "20px";
                bar.$ext.style.height = "150px";
      
                document.body.style.marginBottom = "180px";
            });
            
            it('should automatically save a tab that is changed', function(done) {
                var path  = "/autosave1.txt";
                var tab = changePage(path, function(){
                    expect(tab.document.changed).to.ok
                    
                    save.once("afterSave", function(){
                        fs.readFile(path, function(err, data){
                            if (err) throw err;
                            expect(data).to.equal("test" + path);
                            
                            fs.unlink(path, function(){
                                done();
                            })
                        });
                    })
                });
            });
            
            if (!onload.remain){
                describe("unload()", function(){
                    it('should destroy all ui elements when it is unloaded', function(done) {
                        autosave.unload();
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