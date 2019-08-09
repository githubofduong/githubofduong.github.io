var editor = ace.edit("editor");
    editor.setTheme("ace/theme/dreamweaver");
    editor.session.setMode("ace/mode/json");
    editor.setOptions({
        enableBasicAutocompletion: true,
        enableSnippets: true,
        enableLiveAutocompletion: true
    });

