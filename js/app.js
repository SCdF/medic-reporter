/**
 * User: ryan
 * Date: 12-11-02
 * Time: 2:03 PM
 */
define([
    'jquery',
    'underscore',
    'director',
    'json.edit',
    'codemirror',
    'schema-support',
    './json_format',
    'json!json-forms/simple-example.json',
    'select2',
    'jam/codemirror/mode/javascript/javascript',
    'domReady!',
    'jam/json.edit/addons/enumlabels'
], function ($, _, director, jsonEdit, CodeMirror, translator, json_format, example) {


    var exports = {},
        routes = {
            '/' : no_form_selected,
            '/*/*/*' : form_and_code,
            '/*/*' : form_and_code,
            '/*' : form_only
        },
        router = director.Router(routes),
        json_forms_path = 'json-forms',
        gateway_num = '+13125551212', // todo: make option in app
        editor,
        schema_used,
        selected_form,
        log;

    exports.init = function () {

        init_json_display();
        initNameSelect();

        findAvailableJson(function(err, data){
            renderSelect(data);
            router.init('/');
        })

    };


    function no_form_selected() {
        // on first load, just show the example json form VPD, in english
        showForm(example, 'ZZZZ', 'en');
    }

    function form_only(form_name, callback) {
        $('#choose-form').select2('val', form_name);
        var form_url = resolve_form_url(form_name);
        getForm(form_url, function(err, form) {
            var codes = getFormCodes(form);
            renderFormNameSelect(form_name, codes);
            //$('#choose-form').select2('val', '');
            if (_.isFunction(callback)) {
                callback(null, {
                   form_url : form_url,
                    form : form,
                    codes : codes
                });
            }

        });
    }


    function form_and_code(form_name, code, /*optional*/ lang) {
        if (!lang) lang = 'en';
        form_only(form_name, function(err, details){
            $('#choose-name').select2('val', code);
            showForm(details.form, code, lang);
        })

    }

    function resolve_form_url(form_name) {
        return json_forms_path + '/' + form_name;
    }

    function formatDate(date) {
        var year = date.getYear() - 100
            month = date.getMonth() + 1
            day = date.getDate()
            hours = date.getHours()
            minutes = date.getMinutes();
        //return "#{month}-#{day}-#{year} #{hours}:#{minutes}"
        return month+'-'+day+'-'+year+' '+hours+':'+minutes;
    }

    function request(options, callback) {

        var data = options.data,
            host = options.host || 'localhost',
            port = options.port || 5984,
            path = options.path,
            method = options.method || 'POST',
            headers = options.headers || {'Content-Type': 'application/x-www-form-urlencoded'};

        $.ajax({
            success: function(data, textStatus, xhr) {
                callback(null, data);
            },
            error: function(xhr, textStatus, error) {
                callback(error);
            },
            headers: headers,
            url: path,
            type: method,
            data: data
        });

    };

    //function postToSMSSyncAPI(options, callback) {
    function postMessageHTTP(options, callback) {
        options.path = options.path || '/kujua-base/_design/kujua-base/_rewrite/add';
        options.data = {
            message_id: Math.ceil(Math.random() * 100000),
            //sent_timestamp: formatDate(new Date())
            sent_timestamp: new Date().valueOf(),
            message: options.message,
            from: options.phone
        };
        var val = log.getValue();
        log.setValue(json_format(JSON.stringify(options.data)) +'\n'+val);
        request(options, callback);
    }

    function hasSMSAPI() {
      if (navigator && navigator.mozSms) return true;
    }

    function sendSMS(options, callback) {

      console.log("Sending SMS to "+ num +"; message '"+ msg +"' ...");

      var err,
          num = options.phone,
          msg = options.message;

      if (!navigator || !navigator.mozSms)
          err = 'Mozilla SMS API not available.';

      if (err) return callback(err);

      var r = navigator.mozSms.send(num, msg);
      r.onSuccess = callback(null, r.message);
      r.onError = callback('SMS sending failed.');

    }

    function handleError(data) {
        console.error('error data', data);
        var err;
        try {
            // response should be in JSON format
            var err = JSON.parse(data);
        } catch(e) {
            //console.error(e);
            err = 'Failed to parse response.';
        }
        $('.errors.alert .msg').html('<p>'+err+'</p>')
            .closest('.errors').show();
    };

    function processResponse(err, data) {
        var resp;
        if (err)
            return handleError(err);
        //$('.log').prepend('<p>'+data+'</p>');
        try {
            if (typeof data === 'string')
                resp = JSON.parse(data);
            else if (typeof data === 'object')
                resp = data;
        } catch(e) {
            return handleError(data);
        }
        var val = log.getValue();
        log.setValue(json_format(JSON.stringify(resp)) +'\n'+val);
        if (resp.callback) {
            resp.callback.options.data = JSON.stringify(resp.callback.data);
            request(resp.callback.options, processResponse);
        }
    };


    // Render and bind a form
    function showForm(forms, code, lang) {
        $form_fields = $('#form_fields');
        $form_fields.empty();
        var schemafied = translator(forms, lang);
        schema_used.setValue(json_format(JSON.stringify(schemafied[code].schema)));
        var rendered = jsonEdit('form_fields', schemafied[code].schema);

        function convertToMuvukuFormat(data) {
            var msg = '';
            schemafied[code].schema.order.forEach(function(k) {
                // handle msg header on first iteration
                if (!msg)
                    return msg = '1!'+code+'!'+data[k];
                msg += '#'+ data[k];
            });
            return msg;
        };


        $('form.main').off('submit');
        $('form.main').on('submit', function (ev) {
//            try {
                ev.preventDefault();
                var err_alert = $('.errors.alert');
                err_alert.hide(10).find('.msg').html('');
                err_alert.hide(10).find('.head').html('');

                var data = rendered.collect();
                if (!data.result.ok) {

                    var msg = generateFieldErrorMsg(data.result, schemafied[code].schema);

                    err_alert.show(200)
                        .find('button.close')
                        .on('click', function () { err_alert.hide(); })
                    err_alert.find('h4')
                         .html(data.result.msg + '<br/>' +  msg);
                    return false;
                }
                schemafied[code].validate(data.data, function(err){

                    if (err) {
                        var msg = generateValidationErrorMsg(err);
                        err_alert.show(200)
                            .find('button.close')
                            .on('click', function () { err_alert.hide(); })
                        err_alert.find('h4')
                             .html(msg);
                        return false;
                    }

                    console.log(data.data);

                    schemafied[code].post_save(data.data, function(err, doc) {
                        if (err) return handleError(err);
                        editor.setValue(json_format(JSON.stringify(doc)));
                        var fn = sendSMS;
                        var options = {
                            message: convertToMuvukuFormat(doc),
                            phone: $('.settings form [name=from]').val() || gateway_num
                        };
                        if (!hasSMSAPI()) {
                            fn = postMessageHTTP;
                            options.path = $('.settings form [name=path]').val();
                        }
                        fn(options, processResponse);
                    });
                })


//            } catch (e) {
//                console.log(e);
//            }
            return false;
        });
    }


    function generateValidationErrorMsg(errors) {
        var errs = _.map(errors, function(err) {
            return '<b>'+ err.title+ '</b> ' + err.msg
        });
        return errs.join('<br/>');
    }


    function generateFieldErrorMsg(result, schema) {
        var error = [];
        _.each(result.data, function(value, key){
            if (!value.ok) {
                var msg = value.msg;
                var title = schema.properties[key].title;
                error.push('<b>'+ title+ '</b> ' + msg );
            }
        });
        return error.join('<br/>');

    }


    // Used to find all the .json files in the root of this project
    function findAvailableJson(callback) {
        var results = [];
        $.get(json_forms_path+'/index.json', function(data) {
            var index;
            if (typeof data === 'string')
                index = JSON.parse(data)[0];
            else
                index = data[0];
            index.forEach(function(file) {
                results.push({
                    id: file,
                    text: file
                });
            });
            callback(null, results);
        });
    }

    function init_json_display() {
        var elem = $('.results').get()[0];
        editor = CodeMirror(elem, {
            value : '',
            theme : 'monokai',
            mode : {name: "javascript", json: true}
        });
        editor.setSize(null, 400);


        var elem2 = $('.schema_used').get()[0];
        schema_used = CodeMirror(elem2, {
            value : '',
            readOnly : true,
            theme : 'monokai',
            mode : {name: "javascript", json: true}
        });
        schema_used.setSize(null, 400 );

        var elem3 = $('.log .entry').get()[0];
        log = CodeMirror(elem3, {
            value : '',
            readOnly : true,
            theme : 'monokai',
            mode : {name: "javascript", json: true}
        });
        log.setSize(null, 400 );

    }

    function renderSelect(data){
        $('#choose-form').select2({
            data : data,
            initSelection : function(element, callback) {
                var val = $(element).val();
                var data = {id: val, text: val};
                callback(data);
            }
        }).on('change', function(){
            var val = $(this).val();
            router.setRoute('/' + val);
        })
    }


    function getForm(url, callback) {
        $.getJSON(url, function(data){
            callback(null, data);
        })
    }


    function getFormCodes(form) {
        return _.map(form, function(entry){
            if (entry.meta && entry.meta.code) {
                return {
                    id: entry.meta.code,
                    text : entry.meta.code
                }
            }
        });
    }

    function initNameSelect(){
        $('#choose-name').select2({
            data : [],
        }).select2('disable');
    }

    function renderFormNameSelect(form_name, codes) {

        $('#choose-name').select2({
            data : codes,
            initSelection : function(element, callback) {
                var val = $(element).val();
                var data = {id: val, text: val};
                callback(data);
            }
        })
            .select2('enable')
            .off('change')
            .on('change', function(){
                var code = $(this).val();
                router.setRoute('/' + form_name + '/' + code);
            })
    }


    return exports;
});
