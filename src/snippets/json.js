ace.define("ace/snippets/json",["require","exports","module"], function(require, exports, module) {
"use strict";

exports.snippetText = '\n\
snippet class\n\
    "class": "className"\n\
\n\
';
exports.scope = "json";

});                (function() {
                    ace.require(["ace/snippets/json"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            
