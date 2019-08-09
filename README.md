# githubofduong.github.io

# intelligent-web-based-json-editor-for-security-modeling
Online demo for local work

The editor works with a pre-defined shema, which is similar to this sample JSON text:

    [
        {
            "class" : "Reg_user",
            "permission" : [
                {
                    "resources" : ["ginve_name", "middle_name", "family_name", "email"],
                    "actions" : ["read"],
                    "default" : "self = caller"
                },
                {
                    "resources" : ["ginven_name", "middle_name", "family_name", "email"],
                    "actions" : ["read"],
                    "roles" : ["lecturer"],
                    "auth" : "self.oclAsType(Student).courses->exists(c|c.lectures->includes(caller.oclAsType(Lecturer)))"
                },
                {
                    "resources" : ["ginven_name", "middle_name", "family_name", "email"],
                    "actions" : ["read"],
                    "roles" : ["admin"],
                    "auth" : "true"
                }
            ]
        }
    ]


Important commands:

  (Alt+0): Upload a valid JSON file of data model before editing.
  
    + Sample JSON files to upload can be found in this project as "CarPerson_context.json" and "programDB_context.json".
    
    + Sample JSON file of "CarPerson_context.json":
    
      [
        {
          "class" : "Car",
          "attributes" : [
            {"name" : "Car_ref", "type" : "String"},
            {"name" : "model", "type" : "String"},
            {"name" : "color", "type" : "String"},
            {"name" : "age", "type" : "Integer"}]
        },
        {
          "class" : "Person",
          "attributes" : [
            {"name" : "Person_ref", "type" : "String"},
            {"name" : "name", "type" : "String"},
            {"name" : "surname", "type" : "String"},
            {"name" : "age", "type" : "Integer"}]
        },
        {
          "association" : "Ownership",
          "ends" : ["owners", "ownedCars"],
          "classes" : ["Car", "Person"]
        }
      ]
      
      
  (Ctrl+Space): Suggestion list of terms to auto-complete.
  
    + A part from default keywords, it depends on the JSON file uploaded.
  
  (Ctrl+Shift+B): Beautify a text of JSON in this editor.
  
    + Only work when there is no syntax error.
