function port_handler() {
    this.main_timeout_reference;
    this.initial_ports = false;

    this.port_detected_callbacks = [];
    this.port_removed_callbacks = [];
}

port_handler.prototype.initialize = function() {
    // start listening, check after 250ms
    this.check();
};

port_handler.prototype.check = function() {
    var self = this;

    serial.getDevices(function(current_ports) {
        // port got removed or initial_ports wasn't initialized yet
        if (self.array_difference(self.initial_ports, current_ports).length > 0 || !self.initial_ports) {
            var removed_ports = self.array_difference(self.initial_ports, current_ports);

            if (self.initial_ports != false) {
                if (removed_ports.length > 1) {
                    console.log('PortHandler - Removed: ' + removed_ports);
                } else {
                    console.log('PortHandler - Removed: ' + removed_ports[0]);
                }
            }

            // disconnect "UI" if necessary
            // Keep in mind that this routine can not fire during atmega32u4 reboot procedure !!!
            if (GUI.connected_to) {
                for (var i = 0; i < removed_ports.length; i++) {
                    if (removed_ports[i] == GUI.connected_to) {
                        $('div#port-picker a.connect').click();
                    }
                }
            }

            self.update_port_select(current_ports);

            // trigger callbacks (only after initialization)
            if (self.initial_ports) {
                for (var i = (self.port_removed_callbacks.length - 1); i >= 0; i--) {
                    var obj = self.port_removed_callbacks[i];

                    // remove timeout
                    clearTimeout(obj.timer);

                    // trigger callback
                    obj.code(removed_ports);

                    // remove object from array
                    var index = self.port_removed_callbacks.indexOf(obj);
                    if (index > -1) self.port_removed_callbacks.splice(index, 1);
                }
            }

            // auto-select last used port (only during initialization)
            if (!self.initial_ports) {
                chrome.storage.local.get('last_used_port', function(result) {
                    // if last_used_port was set, we try to select it
                    if (result.last_used_port) {
                        current_ports.forEach(function(port) {
                            if (port == result.last_used_port) {
                                console.log('Selecting last used port: ' + result.last_used_port);

                                $('div#port-picker .port select').val(result.last_used_port);
                            }
                        });
                    } else {
                        console.log('Last used port wasn\'t saved "yet", auto-select disabled.');
                    }
                });
            }

            if (!self.initial_ports) {
                // initialize
                self.initial_ports = current_ports;
            } else {
                for (var i = 0; i < removed_ports.length; i++) {
                    self.initial_ports.splice(self.initial_ports.indexOf(removed_ports[i]), 1);
                }
            }
        }

        // new port detected
        var new_ports = self.array_difference(current_ports, self.initial_ports);

        if (new_ports.length) {
            if (new_ports.length > 1) {
                console.log('PortHandler - Found: ' + new_ports);
            } else {
                console.log('PortHandler - Found: ' + new_ports[0]);
            }

            self.update_port_select(current_ports);

            // select / highlight new port, if connected -> select connected port
            if (!GUI.connected_to) {
                $('div#port-picker .port select').val(new_ports[0]);
            } else {
                $('div#port-picker .port select').val(GUI.connected_to);
            }

            // start connect procedure (if statement is valid)
            if (GUI.auto_connect && !GUI.connecting_to && !GUI.connected_to) {
                // we need firmware flasher protection over here
                if (GUI.active_tab != 'firmware_flasher') {
                    GUI.timeout_add('auto-connect_timeout', function() {
                        $('div#port-picker a.connect').click();
                    }, 50); // small timeout so we won't get any nasty connect errors due to system initializing the bus
                }
            }

            // trigger callbacks
            for (var i = (self.port_detected_callbacks.length - 1); i >= 0; i--) {
                var obj = self.port_detected_callbacks[i];

                // remove timeout
                clearTimeout(obj.timer);

                // trigger callback
                obj.code(new_ports);

                // remove object from array
                var index = self.port_detected_callbacks.indexOf(obj);
                if (index > -1) self.port_detected_callbacks.splice(index, 1);
            }

            self.initial_ports = current_ports;
        }

        self.main_timeout_reference = setTimeout(function() {
            self.check();
        }, 250);
    });
};

port_handler.prototype.update_port_select = function(ports) {
    $('div#port-picker .port select').html(''); // drop previous one

    if (ports.length > 0) {
        for (var i = 0; i < ports.length; i++) {
            $('div#port-picker .port select').append($("<option/>", {value: ports[i], text: ports[i]}));
        }
    } else {
        $('div#port-picker .port select').append($("<option/>", {value: 0, text: 'No Ports'}));
    }
};

port_handler.prototype.port_detected = function(name, code, timeout, ignore_timeout) {
    var self = this;
    var obj = {'name': name, 'code': code, 'timeout': (timeout) ? timeout : 10000};

    if (!ignore_timeout) {
        obj.timer = setTimeout(function() {
            console.log('PortHandler - timeout - ' + obj.name);

            // trigger callback
            code(false);

            // remove object from array
            var index = self.port_detected_callbacks.indexOf(obj);
            if (index > -1) self.port_detected_callbacks.splice(index, 1);
        }, (timeout) ? timeout : 10000);
    } else {
        obj.timer = false;
        obj.timeout = false;
    }

    this.port_detected_callbacks.push(obj);

    return obj;
};

port_handler.prototype.port_removed = function(name, code, timeout, ignore_timeout) {
    var self = this;
    var obj = {'name': name, 'code': code, 'timeout': (timeout) ? timeout : 10000};

    if (!ignore_timeout) {
        obj.timer = setTimeout(function() {
            console.log('PortHandler - timeout - ' + obj.name);

            // trigger callback
            code(false);

            // remove object from array
            var index = self.port_removed_callbacks.indexOf(obj);
            if (index > -1) self.port_removed_callbacks.splice(index, 1);
        }, (timeout) ? timeout : 10000);
    } else {
        obj.timer = false;
        obj.timeout = false;
    }

    this.port_removed_callbacks.push(obj);

    return obj;
};

// accepting single level array with "value" as key
port_handler.prototype.array_difference = function(firstArray, secondArray) {
    var cloneArray = [];

    // create hardcopy
    for (var i = 0; i < firstArray.length; i++) {
        cloneArray.push(firstArray[i]);
    }

    for (var i = 0; i < secondArray.length; i++) {
        if (cloneArray.indexOf(secondArray[i]) != -1) {
            cloneArray.splice(cloneArray.indexOf(secondArray[i]), 1);
        }
    }

    return cloneArray;
};

port_handler.prototype.flush_callbacks = function() {
    var killed = 0;

    for (var i = this.port_detected_callbacks.length - 1; i >= 0; i--) {
        if (this.port_detected_callbacks[i].timer) clearTimeout(this.port_detected_callbacks[i].timer);
        this.port_detected_callbacks.splice(i, 1);

        killed++;
    }

    for (var i = this.port_removed_callbacks.length - 1; i >= 0; i--) {
        if (this.port_removed_callbacks[i].timer) clearTimeout(this.port_removed_callbacks[i].timer);
        this.port_removed_callbacks.splice(i, 1);

        killed++;
    }

    return killed;
};

var PortHandler = new port_handler();