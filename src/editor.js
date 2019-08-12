var editor = ace.edit("editor");
    editor.setTheme("ace/theme/dreamweaver");
    editor.session.setMode("ace/mode/json");
    editor.setOptions({
        enableBasicAutocompletion: true,
        enableSnippets: true,
        enableLiveAutocompletion: true
    });

// var str = [{name: "Regular_User", permission: [{role: "lecturer"}]}];
// var str = editor.session.getValue();
// // if (str) console.log(str);
// str = JSON.parse(str);
// // console.log(str);
// str = JSON.stringify(str, null, 4)
// // console.log(str);
// editor.session.setValue(str);
// console.log(JSON.stringify(str.replace(/\n/g, ""), null, 4));

// var beautify = ace.require("ace/ext/beautify");
//     beautify.beautify(editor.session);
    // var v = new Validator();
    // var instance = 4;
    // var schema = {"type": "number"};
    // console.log(v.validate(instance, schema));