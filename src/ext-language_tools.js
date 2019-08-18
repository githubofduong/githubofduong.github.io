ace.define("ace/snippets",["require","exports","module","ace/lib/oop","ace/lib/event_emitter","ace/lib/lang","ace/range","ace/anchor","ace/keyboard/hash_handler","ace/tokenizer","ace/lib/dom","ace/editor"], function(require, exports, module) {
// "use strict";
var oop = require("./lib/oop");
var EventEmitter = require("./lib/event_emitter").EventEmitter;
var lang = require("./lib/lang");
var Range = require("./range").Range;
var Anchor = require("./anchor").Anchor;
var HashHandler = require("./keyboard/hash_handler").HashHandler;
var Tokenizer = require("./tokenizer").Tokenizer;
var comparePoints = Range.comparePoints;

var SnippetManager = function() {
    this.snippetMap = {};
    this.snippetNameMap = {};
};

(function() {
    oop.implement(this, EventEmitter);
    
    this.getTokenizer = function() {
        function TabstopToken(str, _, stack) {
            str = str.substr(1);
            if (/^\d+$/.test(str) && !stack.inFormatString)
                return [{tabstopId: parseInt(str, 10)}];
            return [{text: str}];
        }
        function escape(ch) {
            return "(?:[^\\\\" + ch + "]|\\\\.)";
        }
        SnippetManager.$tokenizer = new Tokenizer({
            start: [
                {regex: /:/, onMatch: function(val, state, stack) {
                    if (stack.length && stack[0].expectIf) {
                        stack[0].expectIf = false;
                        stack[0].elseBranch = stack[0];
                        return [stack[0]];
                    }
                    return ":";
                }},
                {regex: /\\./, onMatch: function(val, state, stack) {
                    var ch = val[1];
                    if (ch == "}" && stack.length) {
                        val = ch;
                    }else if ("`$\\".indexOf(ch) != -1) {
                        val = ch;
                    } else if (stack.inFormatString) {
                        if (ch == "n")
                            val = "\n";
                        else if (ch == "t")
                            val = "\n";
                        else if ("ulULE".indexOf(ch) != -1) {
                            val = {changeCase: ch, local: ch > "a"};
                        }
                    }

                    return [val];
                }},
                {regex: /}/, onMatch: function(val, state, stack) {
                    return [stack.length ? stack.shift() : val];
                }},
                {regex: /\$(?:\d+|\w+)/, onMatch: TabstopToken},
                {regex: /\$\{[\dA-Z_a-z]+/, onMatch: function(str, state, stack) {
                    var t = TabstopToken(str.substr(1), state, stack);
                    stack.unshift(t[0]);
                    return t;
                }, next: "snippetVar"},
                {regex: /\n/, token: "newline", merge: false}
            ],
            snippetVar: [
                {regex: "\\|" + escape("\\|") + "*\\|", onMatch: function(val, state, stack) {
                    stack[0].choices = val.slice(1, -1).split(",");
                }, next: "start"},
                {regex: "/(" + escape("/") + "+)/(?:(" + escape("/") + "*)/)(\\w*):?",
                 onMatch: function(val, state, stack) {
                    var ts = stack[0];
                    ts.fmtString = val;

                    val = this.splitRegex.exec(val);
                    ts.guard = val[1];
                    ts.fmt = val[2];
                    ts.flag = val[3];
                    return "";
                }, next: "start"},
                {regex: "`" + escape("`") + "*`", onMatch: function(val, state, stack) {
                    stack[0].code = val.splice(1, -1);
                    return "";
                }, next: "start"},
                {regex: "\\?", onMatch: function(val, state, stack) {
                    if (stack[0])
                        stack[0].expectIf = true;
                }, next: "start"},
                {regex: "([^:}\\\\]|\\\\.)*:?", token: "", next: "start"}
            ],
            formatString: [
                {regex: "/(" + escape("/") + "+)/", token: "regex"},
                {regex: "", onMatch: function(val, state, stack) {
                    stack.inFormatString = true;
                }, next: "start"}
            ]
        });
        SnippetManager.prototype.getTokenizer = function() {
            return SnippetManager.$tokenizer;
        };
        return SnippetManager.$tokenizer;
    };

    this.tokenizeTmSnippet = function(str, startState) {
        return this.getTokenizer().getLineTokens(str, startState).tokens.map(function(x) {
            return x.value || x;
        });
    };

    this.$getDefaultValue = function(editor, name) {
        if (/^[A-Z]\d+$/.test(name)) {
            var i = name.substr(1);
            return (this.variables[name[0] + "__"] || {})[i];
        }
        if (/^\d+$/.test(name)) {
            return (this.variables.__ || {})[name];
        }
        name = name.replace(/^TM_/, "");

        if (!editor)
            return;
        var s = editor.session;
        switch(name) {
            case "CURRENT_WORD":
                var r = s.getWordRange();
            case "SELECTION":
            case "SELECTED_TEXT":
                return s.getTextRange(r);
            case "CURRENT_LINE":
                return s.getLine(editor.getCursorPosition().row);
            case "PREV_LINE": // not possible in textmate
                return s.getLine(editor.getCursorPosition().row - 1);
            case "LINE_INDEX":
                return editor.getCursorPosition().column;
            case "LINE_NUMBER":
                return editor.getCursorPosition().row + 1;
            case "SOFT_TABS":
                return s.getUseSoftTabs() ? "YES" : "NO";
            case "TAB_SIZE":
                return s.getTabSize();
            case "FILENAME":
            case "FILEPATH":
                return "";
            case "FULLNAME":
                return "Ace";
        }
    };
    this.variables = {};
    this.getVariableValue = function(editor, varName) {
        if (this.variables.hasOwnProperty(varName))
            return this.variables[varName](editor, varName) || "";
        return this.$getDefaultValue(editor, varName) || "";
    };
    this.tmStrFormat = function(str, ch, editor) {
        var flag = ch.flag || "";
        var re = ch.guard;
        re = new RegExp(re, flag.replace(/[^gi]/, ""));
        var fmtTokens = this.tokenizeTmSnippet(ch.fmt, "formatString");
        var _self = this;
        var formatted = str.replace(re, function() {
            _self.variables.__ = arguments;
            var fmtParts = _self.resolveVariables(fmtTokens, editor);
            var gChangeCase = "E";
            for (var i  = 0; i < fmtParts.length; i++) {
                var ch = fmtParts[i];
                if (typeof ch == "object") {
                    fmtParts[i] = "";
                    if (ch.changeCase && ch.local) {
                        var next = fmtParts[i + 1];
                        if (next && typeof next == "string") {
                            if (ch.changeCase == "u")
                                fmtParts[i] = next[0].toUpperCase();
                            else
                                fmtParts[i] = next[0].toLowerCase();
                            fmtParts[i + 1] = next.substr(1);
                        }
                    } else if (ch.changeCase) {
                        gChangeCase = ch.changeCase;
                    }
                } else if (gChangeCase == "U") {
                    fmtParts[i] = ch.toUpperCase();
                } else if (gChangeCase == "L") {
                    fmtParts[i] = ch.toLowerCase();
                }
            }
            return fmtParts.join("");
        });
        this.variables.__ = null;
        return formatted;
    };

    this.resolveVariables = function(snippet, editor) {
        var result = [];
        for (var i = 0; i < snippet.length; i++) {
            var ch = snippet[i];
            if (typeof ch == "string") {
                result.push(ch);
            } else if (typeof ch != "object") {
                continue;
            } else if (ch.skip) {
                gotoNext(ch);
            } else if (ch.processed < i) {
                continue;
            } else if (ch.text) {
                var value = this.getVariableValue(editor, ch.text);
                if (value && ch.fmtString)
                    value = this.tmStrFormat(value, ch);
                ch.processed = i;
                if (ch.expectIf == null) {
                    if (value) {
                        result.push(value);
                        gotoNext(ch);
                    }
                } else {
                    if (value) {
                        ch.skip = ch.elseBranch;
                    } else
                        gotoNext(ch);
                }
            } else if (ch.tabstopId != null) {
                result.push(ch);
            } else if (ch.changeCase != null) {
                result.push(ch);
            }
        }
        function gotoNext(ch) {
            var i1 = snippet.indexOf(ch, i + 1);
            if (i1 != -1)
                i = i1;
        }
        return result;
    };

    this.insertSnippetForSelection = function(editor, snippetText) {
        var cursor = editor.getCursorPosition();
        var line = editor.session.getLine(cursor.row);
        var tabString = editor.session.getTabString();
        var indentString = line.match(/^\s*/)[0];
        
        if (cursor.column < indentString.length)
            indentString = indentString.slice(0, cursor.column);

        snippetText = snippetText.replace(/\r/g, "");
        var tokens = this.tokenizeTmSnippet(snippetText);
        tokens = this.resolveVariables(tokens, editor);
        tokens = tokens.map(function(x) {
            if (x == "\n")
                return x + indentString;
            if (typeof x == "string")
                return x.replace(/\t/g, tabString);
            return x;
        });
        var tabstops = [];
        tokens.forEach(function(p, i) {
            if (typeof p != "object")
                return;
            var id = p.tabstopId;
            var ts = tabstops[id];
            if (!ts) {
                ts = tabstops[id] = [];
                ts.index = id;
                ts.value = "";
            }
            if (ts.indexOf(p) !== -1)
                return;
            ts.push(p);
            var i1 = tokens.indexOf(p, i + 1);
            if (i1 === -1)
                return;

            var value = tokens.slice(i + 1, i1);
            var isNested = value.some(function(t) {return typeof t === "object";});
            if (isNested && !ts.value) {
                ts.value = value;
            } else if (value.length && (!ts.value || typeof ts.value !== "string")) {
                ts.value = value.join("");
            }
        });
        tabstops.forEach(function(ts) {ts.length = 0;});
        var expanding = {};
        function copyValue(val) {
            var copy = [];
            for (var i = 0; i < val.length; i++) {
                var p = val[i];
                if (typeof p == "object") {
                    if (expanding[p.tabstopId])
                        continue;
                    var j = val.lastIndexOf(p, i - 1);
                    p = copy[j] || {tabstopId: p.tabstopId};
                }
                copy[i] = p;
            }
            return copy;
        }
        for (var i = 0; i < tokens.length; i++) {
            var p = tokens[i];
            if (typeof p != "object")
                continue;
            var id = p.tabstopId;
            var i1 = tokens.indexOf(p, i + 1);
            if (expanding[id]) {
                if (expanding[id] === p)
                    expanding[id] = null;
                continue;
            }
            
            var ts = tabstops[id];
            var arg = typeof ts.value == "string" ? [ts.value] : copyValue(ts.value);
            arg.unshift(i + 1, Math.max(0, i1 - i));
            arg.push(p);
            expanding[id] = p;
            tokens.splice.apply(tokens, arg);

            if (ts.indexOf(p) === -1)
                ts.push(p);
        }
        var row = 0, column = 0;
        var text = "";
        tokens.forEach(function(t) {
            if (typeof t === "string") {
                var lines = t.split("\n");
                if (lines.length > 1){
                    column = lines[lines.length - 1].length;
                    row += lines.length - 1;
                } else
                    column += t.length;
                text += t;
            } else {
                if (!t.start)
                    t.start = {row: row, column: column};
                else
                    t.end = {row: row, column: column};
            }
        });
        var range = editor.getSelectionRange();
        var end = editor.session.replace(range, text);

        var tabstopManager = new TabstopManager(editor);
        var selectionId = editor.inVirtualSelectionMode && editor.selection.index;
        tabstopManager.addTabstops(tabstops, range.start, end, selectionId);
    };
    
    this.insertSnippet = function(editor, snippetText) {
        var self = this;
        if (editor.inVirtualSelectionMode)
            return self.insertSnippetForSelection(editor, snippetText);
        
        editor.forEachSelection(function() {
            self.insertSnippetForSelection(editor, snippetText);
        }, null, {keepOrder: true});
        
        if (editor.tabstopManager)
            editor.tabstopManager.tabNext();
    };

    this.$getScope = function(editor) {
        var scope = editor.session.$mode.$id || "";
        scope = scope.split("/").pop();
        if (scope === "html" || scope === "php") {
            if (scope === "php" && !editor.session.$mode.inlinePhp) 
                scope = "html";
            var c = editor.getCursorPosition();
            var state = editor.session.getState(c.row);
            if (typeof state === "object") {
                state = state[0];
            }
            if (state.substring) {
                if (state.substring(0, 3) == "js-")
                    scope = "javascript";
                else if (state.substring(0, 4) == "css-")
                    scope = "css";
                else if (state.substring(0, 4) == "php-")
                    scope = "php";
            }
        }
        
        return scope;
    };

    this.getActiveScopes = function(editor) {
        var scope = this.$getScope(editor);
        var scopes = [scope];
        var snippetMap = this.snippetMap;
        if (snippetMap[scope] && snippetMap[scope].includeScopes) {
            scopes.push.apply(scopes, snippetMap[scope].includeScopes);
        }
        scopes.push("_");
        return scopes;
    };

    this.expandWithTab = function(editor, options) {
        var self = this;
        var result = editor.forEachSelection(function() {
            return self.expandSnippetForSelection(editor, options);
        }, null, {keepOrder: true});
        if (result && editor.tabstopManager)
            editor.tabstopManager.tabNext();
        return result;
    };
    
    this.expandSnippetForSelection = function(editor, options) {
        var cursor = editor.getCursorPosition();
        var line = editor.session.getLine(cursor.row);
        var before = line.substring(0, cursor.column);
        var after = line.substr(cursor.column);

        var snippetMap = this.snippetMap;
        var snippet;
        this.getActiveScopes(editor).some(function(scope) {
            var snippets = snippetMap[scope];
            if (snippets)
                snippet = this.findMatchingSnippet(snippets, before, after);
            return !!snippet;
        }, this);
        if (!snippet)
            return false;
        if (options && options.dryRun)
            return true;
        editor.session.doc.removeInLine(cursor.row,
            cursor.column - snippet.replaceBefore.length,
            cursor.column + snippet.replaceAfter.length
        );

        this.variables.M__ = snippet.matchBefore;
        this.variables.T__ = snippet.matchAfter;
        this.insertSnippetForSelection(editor, snippet.content);

        this.variables.M__ = this.variables.T__ = null;
        return true;
    };

    this.findMatchingSnippet = function(snippetList, before, after) {
        for (var i = snippetList.length; i--;) {
            var s = snippetList[i];
            if (s.startRe && !s.startRe.test(before))
                continue;
            if (s.endRe && !s.endRe.test(after))
                continue;
            if (!s.startRe && !s.endRe)
                continue;

            s.matchBefore = s.startRe ? s.startRe.exec(before) : [""];
            s.matchAfter = s.endRe ? s.endRe.exec(after) : [""];
            s.replaceBefore = s.triggerRe ? s.triggerRe.exec(before)[0] : "";
            s.replaceAfter = s.endTriggerRe ? s.endTriggerRe.exec(after)[0] : "";
            return s;
        }
    };

    this.snippetMap = {};
    this.snippetNameMap = {};
    this.register = function(snippets, scope) {
        var snippetMap = this.snippetMap;
        var snippetNameMap = this.snippetNameMap;
        var self = this;
        
        if (!snippets) 
            snippets = [];
        
        function wrapRegexp(src) {
            if (src && !/^\^?\(.*\)\$?$|^\\b$/.test(src))
                src = "(?:" + src + ")";

            return src || "";
        }
        function guardedRegexp(re, guard, opening) {
            re = wrapRegexp(re);
            guard = wrapRegexp(guard);
            if (opening) {
                re = guard + re;
                if (re && re[re.length - 1] != "$")
                    re = re + "$";
            } else {
                re = re + guard;
                if (re && re[0] != "^")
                    re = "^" + re;
            }
            return new RegExp(re);
        }

        function addSnippet(s) {
            if (!s.scope)
                s.scope = scope || "_";
            scope = s.scope;
            if (!snippetMap[scope]) {
                snippetMap[scope] = [];
                snippetNameMap[scope] = {};
            }

            var map = snippetNameMap[scope];
            if (s.name) {
                var old = map[s.name];
                if (old)
                    self.unregister(old);
                map[s.name] = s;
            }
            snippetMap[scope].push(s);

            if (s.tabTrigger && !s.trigger) {
                if (!s.guard && /^\w/.test(s.tabTrigger))
                    s.guard = "\\b";
                s.trigger = lang.escapeRegExp(s.tabTrigger);
            }
            
            if (!s.trigger && !s.guard && !s.endTrigger && !s.endGuard)
                return;
            
            s.startRe = guardedRegexp(s.trigger, s.guard, true);
            s.triggerRe = new RegExp(s.trigger);

            s.endRe = guardedRegexp(s.endTrigger, s.endGuard, true);
            s.endTriggerRe = new RegExp(s.endTrigger);
        }

        if (snippets && snippets.content)
            addSnippet(snippets);
        else if (Array.isArray(snippets))
            snippets.forEach(addSnippet);
        
        this._signal("registerSnippets", {scope: scope});
    };
    this.unregister = function(snippets, scope) {
        var snippetMap = this.snippetMap;
        var snippetNameMap = this.snippetNameMap;

        function removeSnippet(s) {
            var nameMap = snippetNameMap[s.scope||scope];
            if (nameMap && nameMap[s.name]) {
                delete nameMap[s.name];
                var map = snippetMap[s.scope||scope];
                var i = map && map.indexOf(s);
                if (i >= 0)
                    map.splice(i, 1);
            }
        }
        if (snippets.content)
            removeSnippet(snippets);
        else if (Array.isArray(snippets))
            snippets.forEach(removeSnippet);
    };
    this.parseSnippetFile = function(str) {
        str = str.replace(/\r/g, "");
        var list = [], snippet = {};
        var re = /^#.*|^({[\s\S]*})\s*$|^(\S+) (.*)$|^((?:\n*\t.*)+)/gm;
        var m;
        while (m = re.exec(str)) {
            if (m[1]) {
                try {
                    snippet = JSON.parse(m[1]);
                    list.push(snippet);
                } catch (e) {}
            } if (m[4]) {
                snippet.content = m[4].replace(/^\t/gm, "");
                list.push(snippet);
                snippet = {};
            } else {
                var key = m[2], val = m[3];
                if (key == "regex") {
                    var guardRe = /\/((?:[^\/\\]|\\.)*)|$/g;
                    snippet.guard = guardRe.exec(val)[1];
                    snippet.trigger = guardRe.exec(val)[1];
                    snippet.endTrigger = guardRe.exec(val)[1];
                    snippet.endGuard = guardRe.exec(val)[1];
                } else if (key == "snippet") {
                    snippet.tabTrigger = val.match(/^\S*/)[0];
                    if (!snippet.name)
                        snippet.name = val;
                } else {
                    snippet[key] = val;
                }
            }
        }
        return list;
    };
    this.getSnippetByName = function(name, editor) {
        var snippetMap = this.snippetNameMap;
        var snippet;
        this.getActiveScopes(editor).some(function(scope) {
            var snippets = snippetMap[scope];
            if (snippets)
                snippet = snippets[name];
            return !!snippet;
        }, this);
        return snippet;
    };

}).call(SnippetManager.prototype);


var TabstopManager = function(editor) {
    if (editor.tabstopManager)
        return editor.tabstopManager;
    editor.tabstopManager = this;
    this.$onChange = this.onChange.bind(this);
    this.$onChangeSelection = lang.delayedCall(this.onChangeSelection.bind(this)).schedule;
    this.$onChangeSession = this.onChangeSession.bind(this);
    this.$onAfterExec = this.onAfterExec.bind(this);
    this.attach(editor);
};
(function() {
    this.attach = function(editor) {
        this.index = 0;
        this.ranges = [];
        this.tabstops = [];
        this.$openTabstops = null;
        this.selectedTabstop = null;

        this.editor = editor;
        this.editor.on("change", this.$onChange);
        this.editor.on("changeSelection", this.$onChangeSelection);
        this.editor.on("changeSession", this.$onChangeSession);
        this.editor.commands.on("afterExec", this.$onAfterExec);
        this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
    };
    this.detach = function() {
        this.tabstops.forEach(this.removeTabstopMarkers, this);
        this.ranges = null;
        this.tabstops = null;
        this.selectedTabstop = null;
        this.editor.removeListener("change", this.$onChange);
        this.editor.removeListener("changeSelection", this.$onChangeSelection);
        this.editor.removeListener("changeSession", this.$onChangeSession);
        this.editor.commands.removeListener("afterExec", this.$onAfterExec);
        this.editor.keyBinding.removeKeyboardHandler(this.keyboardHandler);
        this.editor.tabstopManager = null;
        this.editor = null;
    };

    this.onChange = function(delta) {
        var changeRange = delta;
        var isRemove = delta.action[0] == "r";
        var start = delta.start;
        var end = delta.end;
        var startRow = start.row;
        var endRow = end.row;
        var lineDif = endRow - startRow;
        var colDiff = end.column - start.column;

        if (isRemove) {
            lineDif = -lineDif;
            colDiff = -colDiff;
        }
        if (!this.$inChange && isRemove) {
            var ts = this.selectedTabstop;
            var changedOutside = ts && !ts.some(function(r) {
                return comparePoints(r.start, start) <= 0 && comparePoints(r.end, end) >= 0;
            });
            if (changedOutside)
                return this.detach();
        }
        var ranges = this.ranges;
        for (var i = 0; i < ranges.length; i++) {
            var r = ranges[i];
            if (r.end.row < start.row)
                continue;

            if (isRemove && comparePoints(start, r.start) < 0 && comparePoints(end, r.end) > 0) {
                this.removeRange(r);
                i--;
                continue;
            }

            if (r.start.row == startRow && r.start.column > start.column)
                r.start.column += colDiff;
            if (r.end.row == startRow && r.end.column >= start.column)
                r.end.column += colDiff;
            if (r.start.row >= startRow)
                r.start.row += lineDif;
            if (r.end.row >= startRow)
                r.end.row += lineDif;

            if (comparePoints(r.start, r.end) > 0)
                this.removeRange(r);
        }
        if (!ranges.length)
            this.detach();
    };
    this.updateLinkedFields = function() {
        var ts = this.selectedTabstop;
        if (!ts || !ts.hasLinkedRanges)
            return;
        this.$inChange = true;
        var session = this.editor.session;
        var text = session.getTextRange(ts.firstNonLinked);
        for (var i = ts.length; i--;) {
            var range = ts[i];
            if (!range.linked)
                continue;
            var fmt = snippetManager.tmStrFormat(text, range.original);
            session.replace(range, fmt);
        }
        this.$inChange = false;
    };
    this.onAfterExec = function(e) {
        if (e.command && !e.command.readOnly)
            this.updateLinkedFields();
    };
    this.onChangeSelection = function() {
        if (!this.editor)
            return;
        var lead = this.editor.selection.lead;
        var anchor = this.editor.selection.anchor;
        var isEmpty = this.editor.selection.isEmpty();
        for (var i = this.ranges.length; i--;) {
            if (this.ranges[i].linked)
                continue;
            var containsLead = this.ranges[i].contains(lead.row, lead.column);
            var containsAnchor = isEmpty || this.ranges[i].contains(anchor.row, anchor.column);
            if (containsLead && containsAnchor)
                return;
        }
        this.detach();
    };
    this.onChangeSession = function() {
        this.detach();
    };
    this.tabNext = function(dir) {
        var max = this.tabstops.length;
        var index = this.index + (dir || 1);
        index = Math.min(Math.max(index, 1), max);
        if (index == max)
            index = 0;
        this.selectTabstop(index);
        if (index === 0)
            this.detach();
    };
    this.selectTabstop = function(index) {
        this.$openTabstops = null;
        var ts = this.tabstops[this.index];
        if (ts)
            this.addTabstopMarkers(ts);
        this.index = index;
        ts = this.tabstops[this.index];
        if (!ts || !ts.length)
            return;
        
        this.selectedTabstop = ts;
        if (!this.editor.inVirtualSelectionMode) {        
            var sel = this.editor.multiSelect;
            sel.toSingleRange(ts.firstNonLinked.clone());
            for (var i = ts.length; i--;) {
                if (ts.hasLinkedRanges && ts[i].linked)
                    continue;
                sel.addRange(ts[i].clone(), true);
            }
            if (sel.ranges[0])
                sel.addRange(sel.ranges[0].clone());
        } else {
            this.editor.selection.setRange(ts.firstNonLinked);
        }
        
        this.editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
    };
    this.addTabstops = function(tabstops, start, end) {
        if (!this.$openTabstops)
            this.$openTabstops = [];
        if (!tabstops[0]) {
            var p = Range.fromPoints(end, end);
            moveRelative(p.start, start);
            moveRelative(p.end, start);
            tabstops[0] = [p];
            tabstops[0].index = 0;
        }

        var i = this.index;
        var arg = [i + 1, 0];
        var ranges = this.ranges;
        tabstops.forEach(function(ts, index) {
            var dest = this.$openTabstops[index] || ts;
                
            for (var i = ts.length; i--;) {
                var p = ts[i];
                var range = Range.fromPoints(p.start, p.end || p.start);
                movePoint(range.start, start);
                movePoint(range.end, start);
                range.original = p;
                range.tabstop = dest;
                ranges.push(range);
                if (dest != ts)
                    dest.unshift(range);
                else
                    dest[i] = range;
                if (p.fmtString) {
                    range.linked = true;
                    dest.hasLinkedRanges = true;
                } else if (!dest.firstNonLinked)
                    dest.firstNonLinked = range;
            }
            if (!dest.firstNonLinked)
                dest.hasLinkedRanges = false;
            if (dest === ts) {
                arg.push(dest);
                this.$openTabstops[index] = dest;
            }
            this.addTabstopMarkers(dest);
        }, this);
        
        if (arg.length > 2) {
            if (this.tabstops.length)
                arg.push(arg.splice(2, 1)[0]);
            this.tabstops.splice.apply(this.tabstops, arg);
        }
    };

    this.addTabstopMarkers = function(ts) {
        var session = this.editor.session;
        ts.forEach(function(range) {
            if  (!range.markerId)
                range.markerId = session.addMarker(range, "ace_snippet-marker", "text");
        });
    };
    this.removeTabstopMarkers = function(ts) {
        var session = this.editor.session;
        ts.forEach(function(range) {
            session.removeMarker(range.markerId);
            range.markerId = null;
        });
    };
    this.removeRange = function(range) {
        var i = range.tabstop.indexOf(range);
        range.tabstop.splice(i, 1);
        i = this.ranges.indexOf(range);
        this.ranges.splice(i, 1);
        this.editor.session.removeMarker(range.markerId);
        if (!range.tabstop.length) {
            i = this.tabstops.indexOf(range.tabstop);
            if (i != -1)
                this.tabstops.splice(i, 1);
            if (!this.tabstops.length)
                this.detach();
        }
    };

    this.keyboardHandler = new HashHandler();
    this.keyboardHandler.bindKeys({
        "Tab": function(ed) {
            if (snippetManager && snippetManager.expandWithTab(ed)) {
                return;
            }

            ed.tabstopManager.tabNext(1);
        },
        "Shift-Tab": function(ed) {
            ed.tabstopManager.tabNext(-1);
        },
        "Esc": function(ed) {
            ed.tabstopManager.detach();
        },
        "Return": function(ed) {
            return false;
        }
    });
}).call(TabstopManager.prototype);



var changeTracker = {};
changeTracker.onChange = Anchor.prototype.onChange;
changeTracker.setPosition = function(row, column) {
    this.pos.row = row;
    this.pos.column = column;
};
changeTracker.update = function(pos, delta, $insertRight) {
    this.$insertRight = $insertRight;
    this.pos = pos; 
    this.onChange(delta);
};

var movePoint = function(point, diff) {
    if (point.row == 0)
        point.column += diff.column;
    point.row += diff.row;
};

var moveRelative = function(point, start) {
    if (point.row == start.row)
        point.column -= start.column;
    point.row -= start.row;
};


require("./lib/dom").importCssString("\
.ace_snippet-marker {\
    -moz-box-sizing: border-box;\
    box-sizing: border-box;\
    background: rgba(194, 193, 208, 0.09);\
    border: 1px dotted rgba(211, 208, 235, 0.62);\
    position: absolute;\
}");

exports.snippetManager = new SnippetManager();


var Editor = require("./editor").Editor;
(function() {
    this.insertSnippet = function(content, options) {
        return snippetManager.insertSnippet(this, content, options);
    };
    this.expandSnippet = function(options) {
        return snippetManager.expandWithTab(this, options);
    };
}).call(Editor.prototype);

});

ace.define("ace/autocomplete/popup",["require","exports","module","ace/virtual_renderer","ace/editor","ace/range","ace/lib/event","ace/lib/lang","ace/lib/dom"], function(require, exports, module) {
// "use strict";

var Renderer = require("../virtual_renderer").VirtualRenderer;
var Editor = require("../editor").Editor;
var Range = require("../range").Range;
var event = require("../lib/event");
var lang = require("../lib/lang");
var dom = require("../lib/dom");

var $singleLineEditor = function(el) {
    var renderer = new Renderer(el);

    renderer.$maxLines = 4;

    var editor = new Editor(renderer);

    editor.setHighlightActiveLine(false);
    editor.setShowPrintMargin(false);
    editor.renderer.setShowGutter(false);
    editor.renderer.setHighlightGutterLine(false);

    editor.$mouseHandler.$focusTimeout = 0;
    editor.$highlightTagPending = true;

    return editor;
};

var AcePopup = function(parentNode) {
    var el = dom.createElement("div");
    var popup = new $singleLineEditor(el);

    if (parentNode)
        parentNode.appendChild(el);
    el.style.display = "none";
    popup.renderer.content.style.cursor = "default";
    popup.renderer.setStyle("ace_autocomplete");

    popup.setOption("displayIndentGuides", false);
    popup.setOption("dragDelay", 150);

    var noop = function(){};

    popup.focus = noop;
    popup.$isFocused = true;

    popup.renderer.$cursorLayer.restartTimer = noop;
    popup.renderer.$cursorLayer.element.style.opacity = 0;

    popup.renderer.$maxLines = 8;
    popup.renderer.$keepTextAreaAtCursor = false;

    popup.setHighlightActiveLine(false);
    popup.session.highlight("");
    popup.session.$searchHighlight.clazz = "ace_highlight-marker";

    popup.on("mousedown", function(e) {
        var pos = e.getDocumentPosition();
        popup.selection.moveToPosition(pos);
        selectionMarker.start.row = selectionMarker.end.row = pos.row;
        e.stop();
    });

    var lastMouseEvent;
    var hoverMarker = new Range(-1,0,-1,Infinity);
    var selectionMarker = new Range(-1,0,-1,Infinity);
    selectionMarker.id = popup.session.addMarker(selectionMarker, "ace_active-line", "fullLine");
    popup.setSelectOnHover = function(val) {
        if (!val) {
            hoverMarker.id = popup.session.addMarker(hoverMarker, "ace_line-hover", "fullLine");
        } else if (hoverMarker.id) {
            popup.session.removeMarker(hoverMarker.id);
            hoverMarker.id = null;
        }
    };
    popup.setSelectOnHover(false);
    popup.on("mousemove", function(e) {
        if (!lastMouseEvent) {
            lastMouseEvent = e;
            return;
        }
        if (lastMouseEvent.x == e.x && lastMouseEvent.y == e.y) {
            return;
        }
        lastMouseEvent = e;
        lastMouseEvent.scrollTop = popup.renderer.scrollTop;
        var row = lastMouseEvent.getDocumentPosition().row;
        if (hoverMarker.start.row != row) {
            if (!hoverMarker.id)
                popup.setRow(row);
            setHoverMarker(row);
        }
    });
    popup.renderer.on("beforeRender", function() {
        if (lastMouseEvent && hoverMarker.start.row != -1) {
            lastMouseEvent.$pos = null;
            var row = lastMouseEvent.getDocumentPosition().row;
            if (!hoverMarker.id)
                popup.setRow(row);
            setHoverMarker(row, true);
        }
    });
    popup.renderer.on("afterRender", function() {
        var row = popup.getRow();
        var t = popup.renderer.$textLayer;
        var selected = t.element.childNodes[row - t.config.firstRow];
        if (selected !== t.selectedNode && t.selectedNode)
            dom.removeCssClass(t.selectedNode, "ace_selected");
        t.selectedNode = selected;
        if (selected)
            dom.addCssClass(selected, "ace_selected");
    });
    var hideHoverMarker = function() { setHoverMarker(-1); };
    var setHoverMarker = function(row, suppressRedraw) {
        if (row !== hoverMarker.start.row) {
            hoverMarker.start.row = hoverMarker.end.row = row;
            if (!suppressRedraw)
                popup.session._emit("changeBackMarker");
            popup._emit("changeHoverMarker");
        }
    };
    popup.getHoveredRow = function() {
        return hoverMarker.start.row;
    };

    event.addListener(popup.container, "mouseout", hideHoverMarker);
    popup.on("hide", hideHoverMarker);
    popup.on("changeSelection", hideHoverMarker);

    popup.session.doc.getLength = function() {
        return popup.data.length;
    };
    popup.session.doc.getLine = function(i) {
        var data = popup.data[i];
        if (typeof data == "string")
            return data;
        return (data && data.value) || "";
    };

    var bgTokenizer = popup.session.bgTokenizer;
    bgTokenizer.$tokenizeRow = function(row) {
        var data = popup.data[row];
        var tokens = [];
        if (!data)
            return tokens;
        if (typeof data == "string")
            data = {value: data};
        var caption = data.caption || data.value || data.name;

        function addToken(value, className) {
            value && tokens.push({
                type: (data.className || "") + (className || ""), 
                value: value
            });
        }
        
        var lower = caption.toLowerCase();
        var filterText = (popup.filterText || "").toLowerCase();
        var lastIndex = 0;
        var lastI = 0;
        for (var i = 0; i <= filterText.length; i++) {
            if (i != lastI && (data.matchMask & (1 << i) || i == filterText.length)) {
                var sub = filterText.slice(lastI, i);
                lastI = i;
                var index = lower.indexOf(sub, lastIndex);
                if (index == -1) continue;
                addToken(caption.slice(lastIndex, index), "");
                lastIndex = index + sub.length;
                addToken(caption.slice(index, lastIndex), "completion-highlight");
            }
        }
        addToken(caption.slice(lastIndex, caption.length), "");
        
        if (data.meta)
            tokens.push({type: "completion-meta", value: data.meta});
        if (data.message)
            tokens.push({type: "completion-message", value: data.message});

        return tokens;
    };
    bgTokenizer.$updateOnChange = noop;
    bgTokenizer.start = noop;

    popup.session.$computeWidth = function() {
        return this.screenWidth = 0;
    };
    popup.isOpen = false;
    popup.isTopdown = false;
    popup.autoSelect = true;
    popup.filterText = "";

    popup.data = [];
    popup.setData = function(list, filterText) {
        popup.filterText = filterText || "";
        popup.setValue(lang.stringRepeat("\n", list.length), -1);
        popup.data = list || [];
        popup.setRow(0);
    };
    popup.getData = function(row) {
        return popup.data[row];
    };

    popup.getRow = function() {
        return selectionMarker.start.row;
    };
    popup.setRow = function(line) {
        line = Math.max(this.autoSelect ? 0 : -1, Math.min(this.data.length, line));
        if (selectionMarker.start.row != line) {
            popup.selection.clearSelection();
            selectionMarker.start.row = selectionMarker.end.row = line || 0;
            popup.session._emit("changeBackMarker");
            popup.moveCursorTo(line || 0, 0);
            if (popup.isOpen)
                popup._signal("select");
        }
    };

    popup.on("changeSelection", function() {
        if (popup.isOpen)
            popup.setRow(popup.selection.lead.row);
        popup.renderer.scrollCursorIntoView();
    });

    popup.hide = function() {
        this.container.style.display = "none";
        this._signal("hide");
        popup.isOpen = false;
    };
    popup.show = function(pos, lineHeight, topdownOnly) {
        var el = this.container;
        var screenHeight = window.innerHeight;
        var screenWidth = window.innerWidth;
        var renderer = this.renderer;
        var maxH = renderer.$maxLines * lineHeight * 1.4;
        var top = pos.top + this.$borderSize;
        var allowTopdown = top > screenHeight / 2 && !topdownOnly;
        if (allowTopdown && top + lineHeight + maxH > screenHeight) {
            renderer.$maxPixelHeight = top - 2 * this.$borderSize;
            el.style.top = "";
            el.style.bottom = screenHeight - top + "px";
            popup.isTopdown = false;
        } else {
            top += lineHeight;
            renderer.$maxPixelHeight = screenHeight - top - 0.2 * lineHeight;
            el.style.top = top + "px";
            el.style.bottom = "";
            popup.isTopdown = true;
        }

        el.style.display = "";

        var left = pos.left;
        if (left + el.offsetWidth > screenWidth)
            left = screenWidth - el.offsetWidth;

        el.style.left = left + "px";

        this._signal("show");
        lastMouseEvent = null;
        popup.isOpen = true;
    };

    popup.goTo = function(where) {
        var row = this.getRow();
        var max = this.session.getLength() - 1;

        switch(where) {
            case "up": row = row < 0 ? max : row - 1; break;
            case "down": row = row >= max ? -1 : row + 1; break;
            case "start": row = 0; break;
            case "end": row = max; break;
        }

        this.setRow(row);
    };


    popup.getTextLeftOffset = function() {
        return this.$borderSize + this.renderer.$padding + this.$imageSize;
    };

    popup.$imageSize = 0;
    popup.$borderSize = 1;

    return popup;
};

dom.importCssString("\
.ace_editor.ace_autocomplete .ace_marker-layer .ace_active-line {\
    background-color: #CAD6FA;\
    z-index: 1;\
}\
.ace_dark.ace_editor.ace_autocomplete .ace_marker-layer .ace_active-line {\
    background-color: #3a674e;\
}\
.ace_editor.ace_autocomplete .ace_line-hover {\
    border: 1px solid #abbffe;\
    margin-top: -1px;\
    background: rgba(233,233,253,0.4);\
    position: absolute;\
    z-index: 2;\
}\
.ace_dark.ace_editor.ace_autocomplete .ace_line-hover {\
    border: 1px solid rgba(109, 150, 13, 0.8);\
    background: rgba(58, 103, 78, 0.62);\
}\
.ace_completion-meta {\
    opacity: 0.5;\
    margin: 0.9em;\
}\
.ace_completion-message {\
    color: blue;\
}\
.ace_editor.ace_autocomplete .ace_completion-highlight{\
    color: #2d69c7;\
}\
.ace_dark.ace_editor.ace_autocomplete .ace_completion-highlight{\
    color: #93ca12;\
}\
.ace_editor.ace_autocomplete {\
    width: 300px;\
    z-index: 200000;\
    border: 1px lightgray solid;\
    position: fixed;\
    box-shadow: 2px 3px 5px rgba(0,0,0,.2);\
    line-height: 1.4;\
    background: #fefefe;\
    color: #111;\
}\
.ace_dark.ace_editor.ace_autocomplete {\
    border: 1px #484747 solid;\
    box-shadow: 2px 3px 5px rgba(0, 0, 0, 0.51);\
    line-height: 1.4;\
    background: #25282c;\
    color: #c1c1c1;\
}", "autocompletion.css");

exports.AcePopup = AcePopup;
exports.$singleLineEditor = $singleLineEditor;
});

ace.define("ace/autocomplete/util",["require","exports","module"], function(require, exports, module) {
// "use strict";

exports.parForEach = function(array, fn, callback) {
    var completed = 0;
    var arLength = array.length;
    if (arLength === 0)
        callback();
    for (var i = 0; i < arLength; i++) {
        fn(array[i], function(result, err) {
            completed++;
            if (completed === arLength)
                callback(result, err);
        });
    }
};

var ID_REGEX = /[a-zA-Z_0-9\$\-\u00A2-\uFFFF]/;
// /[^\\]*"[^\s]+[^\\]*"/;

exports.retrievePrecedingIdentifier = function(text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos-1; i >= 0; i--) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf.reverse().join("");
};

exports.retrieveFollowingIdentifier = function(text, pos, regex) {
    regex = regex || ID_REGEX;
    var buf = [];
    for (var i = pos; i < text.length; i++) {
        if (regex.test(text[i]))
            buf.push(text[i]);
        else
            break;
    }
    return buf;
};

exports.cursorInsideDoubleQuotes = function(line, pos) {
    var c = 0, // iterator of char
        lastChar = '', // store previous character
        currentChar, // current char
        count = 0, // represent number of double quote
        lineLength = line.length;

    while (c <= pos) {
        currentChar = line[c];
        if (currentChar == '"' && lastChar != '\\') {
            ++count;
            if (count%2 == 0 && pos <= c) {
                return true;
            }
        }
        ++c; // get next char's index
        lastChar = currentChar;
    }
    return false;
}

exports.getCompletionPrefix = function (editor) {
    var pos = editor.getCursorPosition();
    var line = editor.session.getLine(pos.row);
    var prefix;
    editor.completers.forEach(function(completer) {
        if (completer.identifierRegexps) {// perhaps never
            completer.identifierRegexps.forEach(function(identifierRegex) {
                if (!prefix && identifierRegex)
                    prefix = this.retrievePrecedingIdentifier(line, pos.column, identifierRegex);
            }.bind(this));
        }
    }.bind(this));
    
    // only when the cursor is inside ""
    return this.cursorInsideDoubleQuotes(line, pos.column)
        ? (prefix || this.retrievePrecedingIdentifier(line, pos.column))
        : [];
};

});

ace.define("ace/autocomplete",["require","exports","module","ace/keyboard/hash_handler","ace/autocomplete/popup","ace/autocomplete/util","ace/lib/event","ace/lib/lang","ace/lib/dom","ace/snippets"], function(require, exports, module) {
// "use strict";

var HashHandler = require("./keyboard/hash_handler").HashHandler;
var AcePopup = require("./autocomplete/popup").AcePopup;
var util = require("./autocomplete/util");
var event = require("./lib/event");
var lang = require("./lib/lang");
var dom = require("./lib/dom");
var snippetManager = require("./snippets").snippetManager;

var Autocomplete = function() {
    this.autoInsert = false;
    this.autoSelect = true;
    this.exactMatch = false;
    this.gatherCompletionsId = 0;
    this.keyboardHandler = new HashHandler();
    this.keyboardHandler.bindKeys(this.commands);

    this.blurListener = this.blurListener.bind(this);
    this.changeListener = this.changeListener.bind(this);
    this.mousedownListener = this.mousedownListener.bind(this);
    this.mousewheelListener = this.mousewheelListener.bind(this);

    this.changeTimer = lang.delayedCall(function() {
        this.updateCompletions(true);
    }.bind(this));

    this.tooltipTimer = lang.delayedCall(this.updateDocTooltip.bind(this), 50);
};

(function() {

    this.$init = function() {
        this.popup = new AcePopup(document.body || document.documentElement);
        this.popup.on("click", function(e) {
            this.insertMatch();
            e.stop();
        }.bind(this));
        this.popup.focus = this.editor.focus.bind(this.editor);
        this.popup.on("show", this.tooltipTimer.bind(null, null));
        this.popup.on("select", this.tooltipTimer.bind(null, null));
        this.popup.on("changeHoverMarker", this.tooltipTimer.bind(null, null));
        return this.popup;
    };

    this.getPopup = function() {
        return this.popup || this.$init();
    };

    this.openPopup = function(editor, prefix, keepPopupPosition) {
        if (!this.popup)
            this.$init();

        this.popup.autoSelect = this.autoSelect;

        this.popup.setData(this.completions.filtered, this.completions.filterText);

        editor.keyBinding.addKeyboardHandler(this.keyboardHandler);
        
        var renderer = editor.renderer;
        this.popup.setRow(this.autoSelect ? 0 : -1);
        if (!keepPopupPosition) {
            this.popup.setTheme(editor.getTheme());
            this.popup.setFontSize(editor.getFontSize());

            var lineHeight = renderer.layerConfig.lineHeight;

            var pos = renderer.$cursorLayer.getPixelPosition(this.base, true);
            pos.left -= this.popup.getTextLeftOffset();

            var rect = editor.container.getBoundingClientRect();
            pos.top += rect.top - renderer.layerConfig.offset;
            pos.left += rect.left - editor.renderer.scrollLeft;
            pos.left += renderer.gutterWidth;

            this.popup.show(pos, lineHeight);
        } else if (keepPopupPosition && !prefix) {
            this.detach();
        }
    };

    this.detach = function() {
        this.editor.keyBinding.removeKeyboardHandler(this.keyboardHandler);
        this.editor.off("changeSelection", this.changeListener);
        this.editor.off("blur", this.blurListener);
        this.editor.off("mousedown", this.mousedownListener);
        this.editor.off("mousewheel", this.mousewheelListener);
        this.changeTimer.cancel();
        this.hideDocTooltip();

        this.gatherCompletionsId += 1;
        if (this.popup && this.popup.isOpen)
            this.popup.hide();

        if (this.base)
            this.base.detach();
        this.activated = false;
        this.completions = this.base = null;
    };

    this.changeListener = function(e) {
        var cursor = this.editor.selection.lead;
        if (cursor.row != this.base.row || cursor.column < this.base.column) {
            this.detach();
        }
        if (this.activated)
            this.changeTimer.schedule();
        else
            this.detach();
    };

    this.blurListener = function(e) {
        var el = document.activeElement;
        var text = this.editor.textInput.getElement();
        var fromTooltip = e.relatedTarget && this.tooltipNode && this.tooltipNode.contains(e.relatedTarget);
        var container = this.popup && this.popup.container;
        if (el != text && el.parentNode != container && !fromTooltip
            && el != this.tooltipNode && e.relatedTarget != text
        ) {
            this.detach();
        }
    };

    this.mousedownListener = function(e) {
        this.detach();
    };

    this.mousewheelListener = function(e) {
        this.detach();
    };

    this.goTo = function(where) {
        this.popup.goTo(where);
    };

    this.insertMatch = function(data, options) {
        if (!data)
            data = this.popup.getData(this.popup.getRow());
        if (!data)
            return false;

        if (data.completer && data.completer.insertMatch) {
            data.completer.insertMatch(this.editor, data);
        } else {
            if (this.completions.filterText) {
                var ranges = this.editor.selection.getAllRanges();
                for (var i = 0, range; range = ranges[i]; i++) {
                    range.start.column -= this.completions.filterText.length;
                    this.editor.session.remove(range);
                }
            }
            if (data.snippet)
                snippetManager.insertSnippet(this.editor, data.snippet);
            else
                this.editor.execCommand("insertstring", data.value || data);
        }
        this.detach();
    };


    this.commands = {
        "Up": function(editor) { editor.completer.goTo("up"); },
        "Down": function(editor) { editor.completer.goTo("down"); },
        "Ctrl-Up|Ctrl-Home": function(editor) { editor.completer.goTo("start"); },
        "Ctrl-Down|Ctrl-End": function(editor) { editor.completer.goTo("end"); },

        "Esc": function(editor) { editor.completer.detach(); },
        "Return": function(editor) { return editor.completer.insertMatch(); },
        "Shift-Return": function(editor) { editor.completer.insertMatch(null, {deleteSuffix: true}); },
        "Tab": function(editor) {
            var result = editor.completer.insertMatch();
            if (!result && !editor.tabstopManager)
                editor.completer.goTo("down");
            else
                return result;
        },

        "PageUp": function(editor) { editor.completer.popup.gotoPageUp(); },
        "PageDown": function(editor) { editor.completer.popup.gotoPageDown(); }
    };

    this.gatherCompletions = function(editor, callback) {
        var session = editor.getSession();
        var pos = editor.getCursorPosition();
        var line = editor.session.getLine(pos.row);
        // var doc = editor.getValue();

        var prefix = util.getCompletionPrefix(editor);
        this.base = session.doc.createAnchor(pos.row, pos.column - prefix.length);
        this.base.$insertRight = true;

        // try {
            // var jsonObj = JSON.parse(doc);
            if (util.cursorInsideDoubleQuotes(line, pos.column)) {

                var matches = [];
                var total = editor.completers.length;
                editor.completers.forEach(function(completer, i) {
                    completer.getCompletions(editor, session, pos, prefix, function(err, results) {
                        
                        if (!err && results)
                            matches = matches.concat(results);      
                        callback(null, {
                            prefix: util.getCompletionPrefix(editor),
                            matches: matches,
                            finished: (--total === 0)
                        });
                    });
                });
                return true;
            }
        // } catch (error) {
            
        // }
    };

    this.showPopup = function(editor) {
        if (this.editor)
            this.detach();

        this.activated = true;

        this.editor = editor;
        if (editor.completer != this) {
            if (editor.completer)
                editor.completer.detach();
            editor.completer = this;
        }

        editor.on("changeSelection", this.changeListener);
        editor.on("blur", this.blurListener);
        editor.on("mousedown", this.mousedownListener);
        editor.on("mousewheel", this.mousewheelListener);

        this.updateCompletions();
    };

    this.updateCompletions = function(keepPopupPosition) {
        // autoLiveCompletion skips this block
        if (keepPopupPosition && this.base && this.completions) {
            var pos = this.editor.getCursorPosition();
            var prefix = this.editor.session.getTextRange({start: this.base, end: pos});
            if (prefix == this.completions.filterText)
                return;
            this.completions.setFilter(prefix);
            if (!this.completions.filtered.length)
                return this.detach();
            if (this.completions.filtered.length == 1
            && this.completions.filtered[0].value == prefix
            && !this.completions.filtered[0].snippet)
                return this.detach();
            this.openPopup(this.editor, prefix, keepPopupPosition);
            return;
        } 
        var _id = this.gatherCompletionsId;
        this.gatherCompletions(this.editor, function(err, results) {
            var detachIfFinished = function() {
                if (!results.finished) return;
                return this.detach();
            }.bind(this);

            var prefix = results.prefix;
            var matches = results && results.matches;

            if (!matches || !matches.length)
                return detachIfFinished();
            
            if (prefix.indexOf(results.prefix) !== 0 || _id != this.gatherCompletionsId)
                return;

            this.completions = new FilteredList(matches);

            if (this.exactMatch)
                this.completions.exactMatch = true;

            this.completions.setFilter(prefix);
            var filtered = this.completions.filtered;
            if (!filtered.length)
                return detachIfFinished();
            if (filtered.length == 1 && filtered[0].value == prefix && !filtered[0].snippet)
                return detachIfFinished();
            if (this.autoInsert && filtered.length == 1 && results.finished)
                return this.insertMatch(filtered[0]);

            this.openPopup(this.editor, prefix, keepPopupPosition);
        }.bind(this));
    };

    this.cancelContextMenu = function() {
        this.editor.$mouseHandler.cancelContextMenu();
    };

    this.updateDocTooltip = function() {
        var popup = this.popup;
        var all = popup.data;
        var selected = all && (all[popup.getHoveredRow()] || all[popup.getRow()]);
        var doc = null;
        if (!selected || !this.editor || !this.popup.isOpen)
            return this.hideDocTooltip();
        this.editor.completers.some(function(completer) {
            if (completer.getDocTooltip)
                doc = completer.getDocTooltip(selected);
            return doc;
        });
        if (!doc)
            doc = selected;

        if (typeof doc == "string")
            doc = {docText: doc};
        if (!doc || !(doc.docHTML || doc.docText))
            return this.hideDocTooltip();
        this.showDocTooltip(doc);
    };

    this.showDocTooltip = function(item) {
        if (!this.tooltipNode) {
            this.tooltipNode = dom.createElement("div");
            this.tooltipNode.className = "ace_tooltip ace_doc-tooltip";
            this.tooltipNode.style.margin = 0;
            this.tooltipNode.style.pointerEvents = "auto";
            this.tooltipNode.tabIndex = -1;
            this.tooltipNode.onblur = this.blurListener.bind(this);
            this.tooltipNode.onclick = this.onTooltipClick.bind(this);
        }

        var tooltipNode = this.tooltipNode;
        if (item.docHTML) {
            tooltipNode.innerHTML = item.docHTML;
        } else if (item.docText) {
            tooltipNode.textContent = item.docText;
        }

        if (!tooltipNode.parentNode)
            document.body.appendChild(tooltipNode);
        var popup = this.popup;
        var rect = popup.container.getBoundingClientRect();
        tooltipNode.style.top = popup.container.style.top;
        tooltipNode.style.bottom = popup.container.style.bottom;

        tooltipNode.style.display = "block";
        if (window.innerWidth - rect.right < 320) {
            if (rect.left < 320) {
                if(popup.isTopdown) {
                    tooltipNode.style.top = rect.bottom + "px";
                    tooltipNode.style.left = rect.left + "px";
                    tooltipNode.style.right = "";
                    tooltipNode.style.bottom = "";
                } else {
                    tooltipNode.style.top = popup.container.offsetTop - tooltipNode.offsetHeight + "px";
                    tooltipNode.style.left = rect.left + "px";
                    tooltipNode.style.right = "";
                    tooltipNode.style.bottom = "";
                }
            } else {
                tooltipNode.style.right = window.innerWidth - rect.left + "px";
                tooltipNode.style.left = "";
            }
        } else {
            tooltipNode.style.left = (rect.right + 1) + "px";
            tooltipNode.style.right = "";
        }
    };

    this.hideDocTooltip = function() {
        this.tooltipTimer.cancel();
        if (!this.tooltipNode) return;
        var el = this.tooltipNode;
        if (!this.editor.isFocused() && document.activeElement == el)
            this.editor.focus();
        this.tooltipNode = null;
        if (el.parentNode)
            el.parentNode.removeChild(el);
    };
    
    this.onTooltipClick = function(e) {
        var a = e.target;
        while (a && a != this.tooltipNode) {
            if (a.nodeName == "A" && a.href) {
                a.rel = "noreferrer";
                a.target = "_blank";
                break;
            }
            a = a.parentNode;
        }
    };

}).call(Autocomplete.prototype);

Autocomplete.startCommand = {
    name: "startAutocomplete",
    exec: function(editor) {
        if (!editor.completer)
            editor.completer = new Autocomplete();
        editor.completer.autoInsert = false;
        editor.completer.autoSelect = true;
        editor.completer.showPopup(editor);
        editor.completer.cancelContextMenu();
    },
    bindKey: "Ctrl-Space|Ctrl-Shift-Space|Alt-Space"
};

var FilteredList = function(array, filterText) {
    this.all = array;
    this.filtered = array;
    this.filterText = filterText || "";
    this.exactMatch = false;
};
(function(){
    this.setFilter = function(str) {
        if (str.length > this.filterText && str.lastIndexOf(this.filterText, 0) === 0)
            var matches = this.filtered;
        else
            var matches = this.all;

        this.filterText = str;
        matches = this.filterCompletions(matches, this.filterText);
        matches = matches.sort(function(a, b) {
            return b.exactMatch - a.exactMatch || b.$score - a.$score 
                || (a.caption || a.value) < (b.caption || b.value);
        });
        var prev = null;
        matches = matches.filter(function(item){
            var caption = item.snippet || item.caption || item.value;
            if (caption === prev) return false;
            prev = caption;
            return true;
        });

        this.filtered = matches;
    };
    this.filterCompletions = function(items, needle) {
        var results = [];
        var upper = needle.toUpperCase();
        var lower = needle.toLowerCase();
        loop: for (var i = 0, item; item = items[i]; i++) {
            var caption = item.caption || item.value || item.snippet;
            if (!caption) continue;
            var lastIndex = -1;
            var matchMask = 0;
            var penalty = 0;
            var index, distance;

            if (this.exactMatch) {
                if (needle !== caption.substr(0, needle.length))
                    continue loop;
            } else {
                var fullMatchIndex = caption.toLowerCase().indexOf(lower);
                if (fullMatchIndex > -1) {
                    penalty = fullMatchIndex;
                } else {
                    for (var j = 0; j < needle.length; j++) {
                        var i1 = caption.indexOf(lower[j], lastIndex + 1);
                        var i2 = caption.indexOf(upper[j], lastIndex + 1);
                        index = (i1 >= 0) ? ((i2 < 0 || i1 < i2) ? i1 : i2) : i2;
                        if (index < 0)
                            continue loop;
                        distance = index - lastIndex - 1;
                        if (distance > 0) {
                            if (lastIndex === -1)
                                penalty += 10;
                            penalty += distance;
                            matchMask = matchMask | (1 << j);
                        }
                        lastIndex = index;
                    }
                }
            }
            item.matchMask = matchMask;
            item.exactMatch = penalty ? 0 : 1;
            item.$score = (item.score || 0) - penalty;
            results.push(item);
        }
        return results;
    };
}).call(FilteredList.prototype);

exports.Autocomplete = Autocomplete;
exports.FilteredList = FilteredList;

});

// ace.define("ace/autocomplete/text_completer",["require","exports","module","ace/range"], function(require, exports, module) {
//     var Range = require("../range").Range;
    
//     var splitRegex = /[^a-zA-Z_0-9\$\-\u00C0-\u1FFF\u2C00-\uD7FF\w]+/;

//     function getWordIndex(doc, pos) {
//         var textBefore = doc.getTextRange(Range.fromPoints({row: 0, column:0}, pos));
//         return textBefore.split(splitRegex).length - 1;
//     }
//     function wordDistance(doc, pos) {
//         var prefixPos = getWordIndex(doc, pos);
//         var words = doc.getValue().split(splitRegex);
//         var wordScores = Object.create(null);
        
//         var currentWord = words[prefixPos];

//         words.forEach(function(word, idx) {
//             if (!word || word === currentWord) return;

//             var distance = Math.abs(prefixPos - idx);
//             var score = words.length - distance;
//             if (wordScores[word]) {
//                 wordScores[word] = Math.max(score, wordScores[word]);
//             } else {
//                 wordScores[word] = score;
//             }
//         });
//         return wordScores;
//     }

//     exports.getCompletions = function(editor, session, pos, prefix, callback) {
//         var wordScore = wordDistance(session, pos);
//         var wordList = Object.keys(wordScore);
//         callback(null, wordList.map(function(word) {
//             return {
//                 caption: word,
//                 value: word,
//                 score: wordScore[word],
//                 meta: "local"
//             };
//         }));
//     };
// });

ace.define("ace/ext/language_tools",["require","exports","module","ace/snippets","ace/autocomplete","ace/config","ace/lib/lang","ace/autocomplete/util","ace/autocomplete/text_completer","ace/editor","ace/config", "ace/data-model"], function(require, exports, module) {
// "use strict";

var snippetManager = require("../snippets").snippetManager;
var Autocomplete = require("../autocomplete").Autocomplete;
var config = require("../config");
var lang = require("../lib/lang");
var util = require("../autocomplete/util");
var DataModel = require("ace/data-model").DataModel;
var dataModelObj = new DataModel();

// function to get a list of data model objects for auto-completion
function getClassNames() {

    /*******************  VARIABLES  *************************/
    var classEl,   // class element: iterator of for loop
                   // get JSON array of data model
        dataModel = dataModelObj.getDataModel(),
        className, // placeholder for accessing class name
        classList = []; // list of class names
    /*******************  VARIABLES  *************************/        

    // loop through each JSON object data model
    for (classEl in dataModel) {
        // access each object
        className = dataModel[classEl].class;
        // only get objects having 2 properties 'name' and 'attributes'
        if (className && dataModel[classEl].attributes) {
            classList.push(
                {
                    name: className,
                    value: className,
                    score: 0,
                    meta: "className" // tag name for auto-completion
                }
            );
        }
    }
    return classList;
}

// function to get values of property 'resources' for auto-completion
function getResources(className) {

    /*******************  PARAMETERS  ********************
     * className: name of the class 'resources' belongs to
     *******************  PARAMETERS  ********************/

    /*******************  VARIABLES  *************************/
    var // iterators of for loops
        el, subEl,
        // array of objects containing values for 'resources'
        resources = [],
        // placeholders for accessing elements
        tmpName, tmpAttr, attObj,
        // get array of data model
        dataModel = dataModelObj.getDataModel();
    /*******************  VARIABLES  *************************/

    // loop through data model
    for (el in dataModel) {
        tmpName = dataModel[el].class;      // access property 'class'
        tmpAttr = dataModel[el].attributes; // access property 'attributes'
        // class name found and 'attributes' is an array with at least an element
        if (tmpName == className && Array.isArray(tmpAttr) && tmpAttr.length) {
            for (subEl in tmpAttr) {     // loop through array 'attributes'
                resources.push(tmpAttr[subEl].name);
                // attObj = tmpAttr[subEl]; // access object element of the array
                // resources.push({
                //     name: attObj.name,
                //     value: attObj.name,
                //     score: 0,
                //     meta: "resources"
                // });
            }
        }
    }
    return resources;
}

// function to find the exact property or class name for auto-completion
function findTermInRange(lowerBound, upperBound, terms, doc, cursorIndex) {
    
    /*******************  PARAMETERS  *************************
     * lowerBound, upperBound: indices of the range to search
     * terms: array of possible terms to filter
     * doc: a string containing text input
     *******************  PARAMETERS  ************************/

    /*******************  VARIABLES  *************************/
    var el,        // iterator of for loop
        tmp_term,  // a placeholder for accessing each element
        strStart = '"',
        strEnd = '"\\s*:',
        str,       // modify the search term (adding double quotes, regexp)
        termIndex, // index of currently searching term
        termName,  // name of closest searched term
        oldIndex = 0, // to store the last valid index
                   // range to search
        range = doc.substring(lowerBound, upperBound),
        patt;      // search pattern, RegExp()
    /*******************  VARIABLES  *************************/ 

    cursorIndex = cursorIndex || upperBound;
    cursorIndex -= lowerBound;
    upperBound -= lowerBound;
    // classify array terms
    if (typeof terms[0] == 'object') {
        terms.forEach(function(currentEl, index, arr) {
            arr[index] = currentEl.name;
        });
        strStart = '"class"\\s*:\\s*"';
        strEnd = '"';
    }
    // loop through each element in array terms
    for (el in terms) {
        // access each element
        tmp_term = terms[el];
        // create a string to literal to pass to RegExp()
        str = strStart + tmp_term + strEnd;
        // create a search pattern
        patt = new RegExp(str);
        // find the term's index
        termIndex = range.search(patt);

        // the higher the index, the closer the property to the cursor
        if (oldIndex < termIndex && termIndex < cursorIndex) {
            oldIndex = termIndex; // store the term's index
            termName = tmp_term;  // store the term's name
        }
    }

    switch(termName) {
        case 'resources':
            el = false;
            break;
        case 'actions':
            el = false;
            break;
        case 'roles':
            el = false;
            break;
        default:
            break;
    }
    if (el === false) {
        tmp_term = strStart +termName+ strEnd;
        patt = new RegExp(tmp_term, 'gi');
        if (range.match(patt).length > 1) {return '';}
    
        str = range.substring(oldIndex, cursorIndex);
        patt = new RegExp('"(.|\s)*"\s*:', 'gi');

        if (str.match(patt).length > 1) {return '';}
    }

    return termName;
}

function validateDoubleQuotes(cursorIndex, doc) {

    /**************** PARAMETERS ********************
     * cursorIndex: index of the cursor in the string
     * doc: string array of the document
     **************** PARAMETERS ********************/

    /**************** VARIABLES***********************/
    var // iterator of while loop
        c = 0, i = 0,
        // length of document
        docLength = doc.length,
        // state to mark if iterator c is inside a pair of double quotes
        state = false,
        // identify which block level the cursor is inside
        blockLevel = -1,
        // currentBlockLevel,
        // indices of left curly braces for block level 0 and 1 respectively
        left_0, left_1,
        right_1,
        // left and right characters which are not blank outside double quotes
        leftChar, rightChar, leftCharIndex,
        // to store last character and current character
        lastChar = '', currentChar,
        // to store index of the object the cursor is inside
        objIndex = -1;
        // arrBegin, arrEnd;
    /**************** VARIABLES **********************/


    var arrCounter, blockCounter, // counter of [], {}
        // iterator of main array []
        mainArrStart, mainArrEnd,
        // iterator of permission []
        subArrStart, subArrEnd,
        // iterator of resources, actions, roles []
        resourcesActionsRolesArrStart, resourcesActionsRolesArrEnd,
        // iterator of block of main array
        outerBlockStart, outerBlockEnd,
        // iterator of block of permission
        innerBlockStart, innerBlockEnd,
        
        // trigger for permission, RAR
        pivotSubArr = true, pivotRAR = true,
        // trigger for blocks
        pivotInnerBlock = true, pivotOuterBlock = true,

        // capture level of block, array
        currentBlock, currentArr,
        // capture block of main array
        currentOuterBlockStart, currentOuterBlockEnd,
        // capture block of permission
        currentInnerBlockStart, currentInnerBlockEnd,
        // capture permission []
        currentSubArrStart, currentSubArrEnd,
        // capture resources, actions, roles []
        currentRAR_Start, currentRAR_End;

    mainArrStart = doc.match(/^\s*\[\s*\{\s*/g);
    if (!mainArrStart) {return false}

    mainArrStart = mainArrStart[0]; //console.log(mainArrStart);
    c = mainArrStart.length;
    outerBlockStart = mainArrStart.lastIndexOf('{');
    mainArrStart = mainArrStart.indexOf('[');

    arrCounter = 1;
    blockCounter = 1;
    while(c < docLength) { //console.log("'"+doc[c]+"'");
        currentChar = doc[c];
        switch(currentChar) {
            case '"':
                lastChar !== '\\' ? state = !state : {}
                break;
            case '[':
                if (!state) {
                    if (arrCounter === 1) {
                        subArrStart = c;
                    } else if (arrCounter === 2) {
                        resourcesActionsRolesArrStart = c;
                    } else if (arrCounter > 3) {
                        return false;
                    }
                    ++arrCounter;
                }
                break;
            case ']':
                if (!state) {
                    if (arrCounter === 2) {
                        subArrEnd = c;
                    } else if (arrCounter === 3) {
                        resourcesActionsRolesArrEnd = c;
                    } else if (arrCounter < 0) {
                        return false;
                    }
                    --arrCounter;
                }
                break;
            case '{':
                if (!state) {
                    ++blockCounter;
                    if (blockCounter === 1) {
                        outerBlockStart = c;
                    } else if (blockCounter === 2) {
                        innerBlockStart = c;
                    } else {
                        return false;
                    }
                }
                break;
            case '}':
                if (!state) {
                    if (blockCounter === 2) {
                        innerBlockEnd = c;
                    } else if (blockCounter === 1) {
                        outerBlockEnd = c;
                    } else {
                        return false;
                    }
                    --blockCounter;
                }
                break;
            default:
                break;
        }

        if (!arrCounter) {
            mainArrEnd = c;
            break;
        }

        if (c === cursorIndex) {
            currentBlock = blockCounter;
            currentOuterBlockStart = outerBlockStart;
            if (blockCounter === 2) {
                currentArr = arrCounter;
                currentSubArrStart = subArrStart;
                currentInnerBlockStart = innerBlockStart;
                if (arrCounter === 3) {
                    currentRAR_Start = resourcesActionsRolesArrStart;
                } else {
                    pivotRAR = false;
                }
            } else {
                pivotSubArr = false;
                pivotInnerBlock = false;
                pivotRAR = false;
            }
        }

        // object of main array {}
        if (pivotOuterBlock && blockCounter === 0 && outerBlockEnd > cursorIndex) {
            pivotOuterBlock = false;
            currentOuterBlockEnd = outerBlockEnd;
        }

        // array of permission []
        if (pivotSubArr && arrCounter === 1 && subArrEnd > cursorIndex) {
            pivotSubArr = false;
            currentSubArrEnd = subArrEnd;
        }

        // object of permission {}
        if (pivotInnerBlock && blockCounter === 1 && innerBlockEnd > cursorIndex) {
            pivotInnerBlock = false;
            currentInnerBlockEnd = innerBlockEnd;
        }

        // array of resources, actions, roles []
        if (pivotRAR && arrCounter === 2 && resourcesActionsRolesArrEnd > cursorIndex) {
            pivotRAR = false;
            currentRAR_End = resourcesActionsRolesArrEnd;
        }

        lastChar = currentChar;
        ++c;
    }

    if (doc[c] !== ']' || arrCounter || blockCounter) {return false}
    // cursor must be inside the main array
    if (cursorIndex <= mainArrStart || mainArrEnd <= cursorIndex) {return false}

    if (currentBlock === 1 && currentOuterBlockStart < cursorIndex && cursorIndex < currentOuterBlockEnd) {
        leftCharIndex = findFirstLeftCharIndex(doc, cursorIndex);
        leftChar = doc[leftCharIndex];
        rightChar = findFirstRightChar(doc, cursorIndex);

        if (leftChar === ':') {
            var range = reverseString(doc.substring(currentOuterBlockStart, leftCharIndex)),
                // "class"\s*: ->
                term  = new RegExp('\\s*"' +reverseString('class')+ '"');

            if (range.search(term)) {return false}

            if (doc.substring(currentOuterBlockStart, currentOuterBlockEnd).match(/"class"\s*:/g) > 1) {
                return false;
            }
            
        }

        return {
            blockLevel: currentBlock,
            leftChar: leftChar,
            rightChar: rightChar,
            outerBlockStart: currentOuterBlockStart,
            outerBlockEnd: currentOuterBlockEnd
        }
    } else if (currentBlock === 2) {
        if (currentSubArrStart < currentInnerBlockStart && currentInnerBlockEnd < currentSubArrEnd) {
            var range = reverseString(doc.substring(currentOuterBlockStart, currentSubArrStart)),
                // "permission"\s*:\s*[ -> [\s*:\s*" reverseString() "
                term  = new RegExp('\\s*:\\s*"' +reverseString('permission')+ '"');

            if (range.search(term)) {return false}
            
            if (doc.substring(currentOuterBlockStart, currentOuterBlockEnd).match(/"permission"\s*:/g).length > 1) {
                return false;
            }

            if (currentArr === 3) {
                if (currentRAR_Start <= currentInnerBlockStart || currentInnerBlockEnd <= currentRAR_End) {
                    return false;
                }

                var i = false, el, termArr = ['resources', 'actions', 'roles'];
                range = reverseString(doc.substring(currentInnerBlockStart, currentRAR_Start));

                for (el in termArr) {
                    term = new RegExp('\\s*:\\s*"' +reverseString(termArr[el])+ '"');

                    if (range.search(term)) {continue}

                    term = new RegExp('"' +termArr[el]+ '"\\s*:', 'g');
                    if (doc.substring(currentInnerBlockStart, currentRAR_Start).match(term).length > 1) {
                        return false;
                    }
                    i = true;
                    term = termArr[el];

                    break;
                }
       
                if (!i) {return false;}
            }

            leftCharIndex = findFirstLeftCharIndex(doc, cursorIndex);
            leftChar = doc[leftCharIndex];
            rightChar = findFirstRightChar(doc, cursorIndex);

            return {
                blockLevel: currentBlock,
                leftChar: leftChar,
                rightChar: rightChar,
                outerBlockStart: currentOuterBlockStart,
                outerBlockEnd: currentOuterBlockEnd,
                term: term,
                currentArr: currentArr,
                currentSubArrStart: currentSubArrStart,
                currentSubArrEnd: currentSubArrEnd,
                currentInnerBlockStart: currentInnerBlockStart,
                currentInnerBlockEnd: currentInnerBlockEnd,
                currentRAR_Start: currentRAR_Start,
                currentRAR_End: currentRAR_End
            }
        }
        return false;
    }

    return false;

    // if (doc.search(/(^\s*\[\s*\{)(?:(.|\s))*(\}\s*\]\s*$)/)) {return false;}
    // determine blockLevel
    while (c < cursorIndex) {
        currentChar = doc[c];
        if (currentChar === '"' && lastChar !== '\\') {
            state = !state;
        } else if (currentChar === '{' && !state) {
            if (blockLevel == -1) { left_0 = c; ++objIndex; }
            else if (blockLevel == 0) { left_1 = c }
            ++blockLevel;
        } else if (currentChar === '}' && !state) {
            --blockLevel;
        }
        lastChar = currentChar;
        ++c;
    }

    if (blockLevel > -1) {
        var rightCurlyBrace = blockLevel;
        // in the end, rightCurlyBrace reflects if curly braces are synchronous
        while (rightCurlyBrace !== -1 && c < docLength) {
            currentChar = doc[c];
            if (currentChar === '"' && lastChar !== '\\') {
                state = !state;
            } else if (currentChar === '{' && !state) {
                ++rightCurlyBrace;
            } else if (currentChar === '}' && !state) {
                if (i === 0 && left_1) {
                    right_1 = c;
                    ++i;
                }
                --rightCurlyBrace;
            }
            lastChar = currentChar;
            ++c;
        }
        if (rightCurlyBrace === -1) {
            leftChar = findLeftChar(cursorIndex, doc);
            rightChar = findRightChar(cursorIndex, doc);
            return {
                c: c,
                blockLevel: blockLevel,
                leftChar: leftChar,
                rightChar: rightChar,
                left_0: left_0,
                left_1: left_1,
                right_1: right_1,
                objIndex: objIndex
                // arrBegin: arrBegin,
                // arrEnd: arrEnd
            }
        }
    }
    return false;
}

function reverseString(str) {
    var i = str.length-1,
        newStr = '';
    
    while(i >= 0) {
        newStr += str[i--];
    }
    return newStr;
}

function findFirstLeftCharIndex(doc, cursorIndex) {
    --cursorIndex;
    do {
        cursorIndex = doc.lastIndexOf('"', cursorIndex) - 1;
    } while (doc[cursorIndex] === '\\')

    return doc.substring(0, cursorIndex+1).search(/\s*$/)-1;
}

function findFirstRightChar(doc, cursorIndex) {
    do {
        cursorIndex = doc.indexOf('"', cursorIndex);
    } while(doc[cursorIndex-1] === '\\')

    return doc[doc.substring(cursorIndex+1).search(/[^\s]/)+cursorIndex+1];
}

function findLeftChar(leftUpper, doc) {
    var leftChar,
        leftLine = doc.slice(0, leftUpper);
    do { // find index of left double quote
        leftUpper = leftLine.lastIndexOf('"', leftUpper-1);
    } while (leftUpper > 0 && leftLine[leftUpper-1] === '\\');

    //leftUpper stores the index of left double quote
    while (--leftUpper > 0 && /\s/.test(leftLine[leftUpper]));
    leftChar = leftLine[leftUpper];

    return leftChar;
}

function findRightChar(rightLower, doc) {
    var rightChar,
        docLength = doc.length;
    do { // find index of right double quote
        rightLower = doc.indexOf('"', rightLower);
    } while (rightLower < docLength && doc[rightLower-1] === '\\');

    //rightLower stores the index of right double quote
    while (++rightLower < docLength && /\s/.test(doc[rightLower]));
    rightChar = doc[rightLower];

    return rightChar;
}

function filterClassNames(classList, doc) {
    var el,
        patt,
        index,
        str = '"class"\\s*:\\s*"';

    for (el in classList) {
        patt = new RegExp(str +classList[el].name+ '"');
        index = doc.search(patt);
        if (index !== -1) {
            classList.splice(el, 1);
        }
    }
    return classList;
}

// function filterPropertiesOuter(propertyList, doc, lower, upper) {
//     var el,
//         str = (!lower || !upper) ? doc : doc.slice(lower, upper),
//         patt;

//     for (el in propertyList) {
//         patt = new RegExp('"' +propertyList[el]+ '"\\s*:');
//         if (str.search(patt) !== -1) {
//             propertyList.splice(el, el+1);
//         }
//     }
//     return propertyList;
// }

function filterProperties(propertyList, doc, lower, upper) {
    var str = (!lower || !upper) ? doc : doc.slice(lower, upper),
        i = 0,
        patt,
        tmp,
        hasDefault = hasRoles = hasAuth = false;

    while (i < propertyList.length) {
        tmp = propertyList[i];
        patt = new RegExp('"' +tmp+ '"\\s*:');
        if (str.search(patt) !== -1) {
            switch(tmp) {
                case 'default':
                    hasDefault = true;
                    break;
                case 'roles':
                    hasRoles = true;
                    break;
                case 'auth':
                    hasAuth = true;
                    break;
                default:
                    break;
            }
            propertyList.splice(i, 1);
        } else {
            ++i;
        }
    }
    if (hasDefault) {
        hasRoles = propertyList.indexOf('roles');
        hasRoles >= 0 ? propertyList.splice(hasRoles, 1) : {};
        hasAuth = propertyList.indexOf('auth');
        hasAuth >= 0 ? propertyList.splice(hasAuth, 1) : {};
    } else if (hasRoles || hasAuth) {
        hasDefault = propertyList.indexOf('default');
        hasDefault >= 0 ? propertyList.splice(hasDefault, 1) : {};
        
    }
    return propertyList;
}

function filterArrValues(property, values, doc, lower, upper) {
    var str = doc.slice(lower, upper),
        patt = new RegExp('"' +property+ '"\\s*:\\s*\\[.*\\]'),
        res,
        arr = [];

    res = str.match(patt);
    if (!res) {return arr;}
    str = res[0].match(/\[.*\]/)[0];
    values.filter(function(currentValue) {
        str.indexOf('"'+currentValue+'"') === -1 ? arr.push(currentValue) : {};
    });
    return arr;
}

function getKeywordList(editor, pos) {

    var // convert position to index of cursor
        cursorIndex = editor.getSession().getDocument().positionToIndex(pos),
        // get text document as a string
        doc = editor.getValue(),
        // fetch necessary info
        validatedResult = validateDoubleQuotes(cursorIndex, doc);

    if (validatedResult) {
        var // array to return list of keywords
            kwList,
            // class name of the object the cursor is inside
            className,
            // store a list of class names of data model
            classList = getClassNames(),
            // property name of the double quotes that the cursor is inside
            propertyName,
            // lists of properties
            propertyList_1 = ['resources', 'actions', 'roles'],
            propertyList_2 = ['default', 'auth'],
            // alias for validatedResult
            res = validatedResult,
            // getting properties
            blockLevel = res.blockLevel,
            leftChar = res.leftChar,
            rightChar = res.rightChar,
            outerBlockStart = res.outerBlockStart,
            outerBlockEnd = res.outerBlockEnd;
            // arrBegin = res.arrBegin,
            // arrEnd = res.arrEnd;
        
        // function validateClass() { //console.log("validateClass()");
        //     // var patt = new RegExp(/(?:"permission"\s*:\s*\[(.|\s)*\}\s*\])/);
        //     var range = doc.substring(left_0, c),
        //         tmpCursor = cursorIndex - left_0,
        //         // lower = 0, upper = c - left_0,
        //         classIndex = range.lastIndexOf('"class"', tmpCursor);

        //     if (classIndex === -1) {return false;}
        //     var str = range.substring(classIndex, tmpCursor),
        //         tmp = str.search(/^"class"\s*:\s*"$/gi);

        //     if (tmp) {return false;}
            
        //     var patt = new RegExp(/"permission"\s*:\s*\[(.|\s)*\}\s*\]/gi),
        //         pArr = range.match(patt);

        //     if (pArr && pArr.length > 1) {return false;}
            
        //     // 0 perm: count "class" in range
            
        //     if (!pArr) {
        //         str = range;
        //     } else {
        //         var pIndex = range.search(patt),
        //             len = range.match(patt)[0].length;
        //         str = range.substring(0, pIndex) + range.substring(pIndex+len);
        //     }
        //     // 1 perm: count "class" from left_0 to perm and perm to c
        //     //   class > 1 return false
        //     var len = str.match(/"class"\s*:/).length;
        //     if (len === 1) {return true;}
            
        //     return false;
        // }

        if (blockLevel === 1) {
            if (leftChar === ':') {
                return filterClassNames(classList, doc);
            } else if ((leftChar === '{' || leftChar === ',')  && (rightChar === ',' || rightChar === '}')) {
                kwList = ['class', 'permission'];
                kwList = filterProperties(kwList, doc, outerBlockStart, outerBlockEnd);
                return editor.session.$mode.getCompletions(kwList);
            }
        } else if (blockLevel === 2) {
            var term = res.term,
                currentArr = res.currentArr,
                currentSubArrStart = res.currentSubArrStart,
                currentSubArrEnd = res.currentSubArrEnd,
                currentInnerBlockStart = res.currentInnerBlockStart,
                currentInnerBlockEnd = res.currentInnerBlockEnd,
                currentRAR_Start = res.currentRAR_Start,
                currentRAR_End = res.currentRAR_End;

            if (currentArr === 2 && leftChar !== ':') {
                kwList = ['resources', 'actions', 'default', 'roles', 'auth'];
                kwList = filterProperties(kwList, doc, currentInnerBlockStart, currentInnerBlockEnd);
                return editor.session.$mode.getCompletions(kwList);
            } else if (currentArr === 3) {
                switch(term) {
                    case 'resources':
                        className = findTermInRange(outerBlockStart, outerBlockEnd, classList, doc);
                        kwList = getResources(className);
                        kwList = filterArrValues('resources', kwList, doc, currentInnerBlockStart, currentInnerBlockEnd);
                        return editor.session.$mode.getCompletions(kwList, 'resources');
                    case 'actions':
                        kwList = ['create', 'read', 'update', 'delete'];
                        kwList = filterArrValues('actions', kwList, doc, outerBlockStart, outerBlockEnd);
                        return editor.session.$mode.getCompletions(kwList, 'actions');
                    case 'roles':
                        kwList = ['admin', 'lecturer'];
                        kwList = filterArrValues('roles', kwList, doc, outerBlockStart, outerBlockEnd);
                        return editor.session.$mode.getCompletions(kwList, 'roles');
                    default:
                        return null;
                }
            }
        }
                

        // if (leftChar === ':' &&  !blockLevel) {
        //     if (validateClass()) {
        //         return filterClassNames(classList, doc);
        //     }
        //     return null;
        // } else {

        //     // values for 'resources', 'actions', 'roles'
        //     if ((leftChar === '[' || leftChar === ',') && (rightChar === ']' || rightChar === ',')) {

        //         // search for the corresponding property keyword
        //         propertyName = findTermInRange(left_1, right_1, propertyList_1, doc, cursorIndex);
        //         switch (propertyName) {
        //             case 'resources':
        //                 className = findTermInRange(left_0, c, classList, doc);
        //                 kwList = getResources(className);
        //                 kwList = filterArrValues('resources', kwList, doc, left_1, c);
        //                 return editor.session.$mode.getCompletions(kwList, 'resources');
        //             case 'actions':
        //                 kwList = ['create', 'read', 'update', 'delete'];
        //                 kwList = filterArrValues('actions', kwList, doc, left_1, c);
        //                 return editor.session.$mode.getCompletions(kwList, 'actions');
        //             case 'roles':
        //                 kwList = ['admin', 'lecturer'];
        //                 kwList = filterArrValues('roles', kwList, doc, left_1, c);
        //                 return editor.session.$mode.getCompletions(kwList, 'roles');
        //             default:
        //                 return null;
        //         }
        //     // values for 'default', 'auth'
        //     } else if (leftChar === ':' && blockLevel === 1) {
        //         return null;
        //         // search for the corresponding property keyword
        //         // propertyName = findTermInRange(left_1, cursorIndex, propertyList_2, doc);

        //         // switch(propertyName) {
        //             // case 'default':
        //                 // return null;
        //                 // kwList = ['self = caller'];
        //                 // return editor.session.$mode.getCompletions(kwList, 'default');
        //             // case 'auth':
        //                 // return null;
        //                 // kwList = ['true', 'self.oclAsType(Student).courses->exists(c|c.lectures->includes(caller.oclAsType(Lecturer)))'];
        //                 // return editor.session.$mode.getCompletions(kwList, 'auth');
        //             // default:
        //                 // return null;
        //         // }
        //     } else { // for keywords of properties
        //         if (blockLevel === 0) { // 'class', 'permission'
        //             kwList = ['class', 'permission'];
        //             kwList = filterProperties(kwList, doc, left_0, c);
        //         } else if (blockLevel === 1) { // 'resources', 'actions', 'default' or 'roles', 'auth'
        //             kwList = ['resources', 'actions', 'default', 'roles', 'auth'];
        //             kwList = filterProperties(kwList, doc, left_1, c);
        //         }
        //         return kwList ? editor.session.$mode.getCompletions(kwList) : [];
        //     }
        // }
    }
    return null;
}

var keyWordCompleter = {
    getCompletions: function(editor, session, pos, prefix, callback) {
        if (session.$mode.completer) { // not run
            return session.$mode.completer.getCompletions(editor, session, pos, prefix, callback);
        }
        var completions = getKeywordList(editor, pos);
        callback(null, completions);
    }
};

var snippetCompleter = {
    getCompletions: function(editor, session, pos, prefix, callback) {
        var scopes = [];
        var token = session.getTokenAt(pos.row, pos.column);
        if (token && token.type.match(/(tag-name|tag-open|tag-whitespace|attribute-name|attribute-value)\.xml$/))
            scopes.push('html-tag');
        else
            scopes = snippetManager.getActiveScopes(editor);

        var snippetMap = snippetManager.snippetMap;
        var completions = [];
        scopes.forEach(function(scope) {
            // length of snippets is 0
            var snippets = snippetMap[scope] || [];
            for (var i = snippets.length; i--;) {
                var s = snippets[i];
                var caption = s.name || s.tabTrigger;
                if (!caption)
                    continue;
                completions.push({
                    caption: caption,
                    snippet: s.content,
                    meta: s.tabTrigger && !s.name ? s.tabTrigger + "\u21E5 " : "snippet",
                    type: "snippet"
                });
            }
        }, this);
        callback(null, completions);
    },
    getDocTooltip: function(item) {
        if (item.type == "snippet" && !item.docHTML) {
            item.docHTML = [
                "<b>", lang.escapeHTML(item.caption), "</b>", "<hr></hr>",
                lang.escapeHTML(item.snippet)
            ].join("");
        }
    }
};

var completers = [keyWordCompleter];
exports.setCompleters = function(val) {
    completers.length = 0;
    if (val) completers.push.apply(completers, val);
};
exports.addCompleter = function(completer) {
    completers.push(completer);
};
// exports.textCompleter = textCompleter;
exports.keyWordCompleter = keyWordCompleter;
exports.snippetCompleter = snippetCompleter;

var expandSnippet = {
    name: "expandSnippet",
    exec: function(editor) {
        return snippetManager.expandWithTab(editor);
    },
    bindKey: "Tab"
};

var onChangeMode = function(e, editor) {
    loadSnippetsForMode(editor.session.$mode);
};

var loadSnippetsForMode = function(mode) {
    var id = mode.$id;
    if (!snippetManager.files)
        snippetManager.files = {};
    loadSnippetFile(id);
    if (mode.modes)
        mode.modes.forEach(loadSnippetsForMode);
};

var loadSnippetFile = function(id) {
    if (!id || snippetManager.files[id])
        return;
    var snippetFilePath = id.replace("mode", "snippets");
    snippetManager.files[id] = {};
    config.loadModule(snippetFilePath, function(m) {
        if (m) {
            snippetManager.files[id] = m;
            if (!m.snippets && m.snippetText)
                m.snippets = snippetManager.parseSnippetFile(m.snippetText);
            snippetManager.register(m.snippets || [], m.scope);
            if (m.includeScopes) {
                snippetManager.snippetMap[m.scope].includeScopes = m.includeScopes;
                m.includeScopes.forEach(function(x) {
                    loadSnippetFile("ace/mode/" + x);
                });
            }
        }
    });
};

var doLiveAutocomplete = function(e) {
    var editor = e.editor;
    var hasCompleter = editor.completer && editor.completer.activated;
    if (e.command.name === "backspace") {
        if (hasCompleter && !util.getCompletionPrefix(editor))
            editor.completer.detach();
    }
    else if (e.command.name === "insertstring") {
        var prefix = util.getCompletionPrefix(editor);
        if (prefix && !hasCompleter) {
            if (!editor.completer) {
                editor.completer = new Autocomplete();
            }
            editor.completer.autoInsert = false;
            editor.completer.showPopup(editor);
        }
    }
};

var Editor = require("../editor").Editor;
require("../config").defineOptions(Editor.prototype, "editor", {
    enableBasicAutocompletion: {
        set: function(val) {
            if (val) {
                if (!this.completers)
                    this.completers = Array.isArray(val)? val: completers;
                this.commands.addCommand(Autocomplete.startCommand);
            } else {
                this.commands.removeCommand(Autocomplete.startCommand);
            }
        },
        value: false
    },
    enableLiveAutocompletion: {
        set: function(val) {
            if (val) {
                if (!this.completers)
                    this.completers = Array.isArray(val)? val: completers;
                this.commands.on('afterExec', doLiveAutocomplete);
            } else {
                this.commands.removeListener('afterExec', doLiveAutocomplete);
            }
        },
        value: false
    },
    enableSnippets: {
        set: function(val) {
            if (val) {
                this.commands.addCommand(expandSnippet);
                this.on("changeMode", onChangeMode);
                onChangeMode(null, this);
            } else {
                this.commands.removeCommand(expandSnippet);
                this.off("changeMode", onChangeMode);
            }
        },
        value: false
    }
});
});                (function() {
                    ace.require(["ace/ext/language_tools"], function(m) {
                        if (typeof module == "object" && typeof exports == "object" && module) {
                            module.exports = m;
                        }
                    });
                })();
            