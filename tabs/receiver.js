function tab_initialize_receiver() {
    ga_tracker.sendAppView('Receiver Page');
    GUI.active_tab = 'receiver';

    send_message(MSP_codes.MSP_RC_TUNING, false, false, get_rc_data);

    function get_rc_data() {
        send_message(MSP_codes.MSP_RC, false, false, load_html);
    }

    function load_html() {
        $('#content').load("./tabs/receiver.html", process_html);
    }

    function process_html() {
        // fill in data from RC_tuning
        $('.tunings .throttle input[name="mid"]').val(RC_tuning.throttle_MID.toFixed(2));
        $('.tunings .throttle input[name="expo"]').val(RC_tuning.throttle_EXPO.toFixed(2));

        $('.tunings .rate input[name="rate"]').val(RC_tuning.RC_RATE.toFixed(2));
        $('.tunings .rate input[name="expo"]').val(RC_tuning.RC_EXPO.toFixed(2));

        chrome.storage.local.get('rx_refresh_rate', function(result) {
            if (typeof result.rx_refresh_rate != 'undefined') {
                $('select[name="rx_refresh_rate"]').val(result.rx_refresh_rate).change();
            } else {
                $('select[name="rx_refresh_rate"]').change(); // start with default value
            }
        });

        // UI Hooks
        // curves
        $('.tunings .throttle input').change(function() {
            setTimeout(function() {
                var mid = parseFloat($('.tunings .throttle input[name="mid"]').val());
                var expo = parseFloat($('.tunings .throttle input[name="expo"]').val());

                var throttle_curve = $('.throttle_curve canvas').get(0);
                var context = throttle_curve.getContext("2d");
                context.clearRect(0, 0, 220, 58);

                // math magic by englishman
                var midx = 220 * mid;
                var midxl = midx * 0.5;
                var midxr = (((220 - midx) * 0.5) + midx);
                var midy = 58 - (midx * (58 / 220));
                var midyl = 58 - ((58 - midy) * 0.5 *(expo + 1));
                var midyr = (midy / 2) * (expo + 1);

                context.beginPath();
                context.moveTo(0, 58);
                context.quadraticCurveTo(midxl, midyl, midx, midy);
                context.moveTo(midx, midy);
                context.quadraticCurveTo(midxr, midyr, 220, 0);

                context.lineWidth = 2;
                context.stroke();
            }, 0); // race condition, that should always trigger after all events are processed
        }).change();

        $('.tunings .rate input').change(function() {
            setTimeout(function() {
                var rate = parseFloat($('.tunings .rate input[name="rate"]').val());
                var expo = parseFloat($('.tunings .rate input[name="expo"]').val());

                var pitch_roll_curve = $('.pitch_roll_curve canvas').get(0);
                var context = pitch_roll_curve.getContext("2d");
                context.clearRect(0, 0, 220, 58);

                // math magic by englishman
                var ratey = 58 * rate;

                context.beginPath();
                context.moveTo(0, 58);
                context.quadraticCurveTo(110, 58 - ((ratey / 2) * (1 - expo)), 220, 58 - ratey);
                context.lineWidth = 2;
                context.stroke();
            }, 0); // race condition, that should always trigger after all events are processed
        }).change();

        $('a.refresh').click(function() {
            send_message(MSP_codes.MSP_RC_TUNING, false, false, function() {
                GUI.log('RC Tuning data <strong>refreshed</strong>');

                // fill in data from RC_tuning
                $('.tunings .throttle input[name="mid"]').val(RC_tuning.throttle_MID.toFixed(2));
                $('.tunings .throttle input[name="expo"]').val(RC_tuning.throttle_EXPO.toFixed(2));

                $('.tunings .rate input[name="rate"]').val(RC_tuning.RC_RATE.toFixed(2));
                $('.tunings .rate input[name="expo"]').val(RC_tuning.RC_EXPO.toFixed(2));

                // update visual representation
                $('.tunings .throttle input').change();
                $('.tunings .rate input').change();
            });
        });

        $('a.update').click(function() {
            // catch RC_tuning changes
            RC_tuning.throttle_MID = parseFloat($('.tunings .throttle input[name="mid"]').val());
            RC_tuning.throttle_EXPO = parseFloat($('.tunings .throttle input[name="expo"]').val());

            RC_tuning.RC_RATE = parseFloat($('.tunings .rate input[name="rate"]').val());
            RC_tuning.RC_EXPO = parseFloat($('.tunings .rate input[name="expo"]').val());

            var RC_tuning_buffer_out = new Array();
            RC_tuning_buffer_out[0] = parseInt(RC_tuning.RC_RATE * 100, 10);
            RC_tuning_buffer_out[1] = parseInt(RC_tuning.RC_EXPO * 100, 10);
            RC_tuning_buffer_out[2] = parseInt(RC_tuning.roll_pitch_rate * 100, 10);
            RC_tuning_buffer_out[3] = parseInt(RC_tuning.yaw_rate * 100, 10);
            RC_tuning_buffer_out[4] = parseInt(RC_tuning.dynamic_THR_PID * 100, 10);
            RC_tuning_buffer_out[5] = parseInt(RC_tuning.throttle_MID * 100, 10);
            RC_tuning_buffer_out[6] = parseInt(RC_tuning.throttle_EXPO * 100, 10);

            // Send over the RC_tuning changes
            send_message(MSP_codes.MSP_SET_RC_TUNING, RC_tuning_buffer_out, false, save_to_eeprom);

            function save_to_eeprom() {
                send_message(MSP_codes.MSP_EEPROM_WRITE, false, false, function() {
                    GUI.log('EEPROM <span style="color: green">saved</span>');

                    var element = $('a.update');
                    element.addClass('success');

                    GUI.timeout_add('success_highlight', function() {
                        element.removeClass('success');
                    }, 2000);
                });
            }
        });

        $('select[name="rx_refresh_rate"]').change(function() {
            var plot_update_rate = parseInt($(this).val(), 10);

            // save update rate
            chrome.storage.local.set({'rx_refresh_rate': plot_update_rate});

            function get_rc_data() {
                send_message(MSP_codes.MSP_RC, false, false, update_ui);
            }

            var meter_array = [];
            $('.tab-receiver meter').each(function() {
                meter_array.push($(this));
            });

            var meter_values_array = [];
            $('.tab-receiver .value').each(function() {
                meter_values_array.push($(this));
            });

            // setup plot
            var RX_plot_data = new Array(8);
            for (var i = 0; i < 8; i++) {
                RX_plot_data[i] = [];
            }

            var samples = 0;
            var svg = d3.select("svg");

            var width, height, widthScale, heightScale;
            function update_receiver_plot_size() {
                var margin = {top: 20, right: 20, bottom: 10, left: 40};
                width = $('#RX_plot').width() - margin.left - margin.right;
                height = $('#RX_plot').height() - margin.top - margin.bottom;

                widthScale.range([0, width]);
                heightScale.range([height, 0]);
            }

            function update_ui() {
                meter_array[0].val(RC.throttle);
                meter_values_array[0].text('[ ' + RC.throttle + ' ]');

                meter_array[1].val(RC.pitch);
                meter_values_array[1].text('[ ' + RC.pitch + ' ]');

                meter_array[2].val(RC.roll);
                meter_values_array[2].text('[ ' + RC.roll + ' ]');

                meter_array[3].val(RC.yaw);
                meter_values_array[3].text('[ ' + RC.yaw + ' ]');

                meter_array[4].val(RC.AUX1);
                meter_values_array[4].text('[ ' + RC.AUX1 + ' ]');

                meter_array[5].val(RC.AUX2);
                meter_values_array[5].text('[ ' + RC.AUX2 + ' ]');

                meter_array[6].val(RC.AUX3);
                meter_values_array[6].text('[ ' + RC.AUX3 + ' ]');

                meter_array[7].val(RC.AUX4);
                meter_values_array[7].text('[ ' + RC.AUX4 + ' ]');

                // push latest data to the main array
                RX_plot_data[0].push([samples, RC.throttle]);
                RX_plot_data[1].push([samples, RC.pitch]);
                RX_plot_data[2].push([samples, RC.roll]);
                RX_plot_data[3].push([samples, RC.yaw]);
                RX_plot_data[4].push([samples, RC.AUX1]);
                RX_plot_data[5].push([samples, RC.AUX2]);
                RX_plot_data[6].push([samples, RC.AUX3]);
                RX_plot_data[7].push([samples, RC.AUX4]);

                // Remove old data from array
                while (RX_plot_data[0].length > 300) {
                    RX_plot_data[0].shift();
                    RX_plot_data[1].shift();
                    RX_plot_data[2].shift();
                    RX_plot_data[3].shift();
                    RX_plot_data[4].shift();
                    RX_plot_data[5].shift();
                    RX_plot_data[6].shift();
                    RX_plot_data[7].shift();
                }

                // update required parts of the plot
                widthScale = d3.scale.linear().
                    domain([(samples - 299), samples]);

                heightScale = d3.scale.linear().
                    domain([800, 2200]);

                update_receiver_plot_size();

                var xGrid = d3.svg.axis().
                    scale(widthScale).
                    orient("bottom").
                    tickSize(-height, 0, 0).
                    tickFormat("");

                var yGrid = d3.svg.axis().
                    scale(heightScale).
                    orient("left").
                    tickSize(-width, 0, 0).
                    tickFormat("");

                var xAxis = d3.svg.axis().
                    scale(widthScale).
                    orient("bottom").
                    tickFormat(function(d) {return d;});

                var yAxis = d3.svg.axis().
                    scale(heightScale).
                    orient("left").
                    tickFormat(function(d) {return d;});

                var line = d3.svg.line().
                    x(function(d) {return widthScale(d[0]);}).
                    y(function(d) {return heightScale(d[1]);});

                svg.select(".x.grid").call(xGrid);
                svg.select(".y.grid").call(yGrid);
                svg.select(".x.axis").call(xAxis);
                svg.select(".y.axis").call(yAxis);

                var data = svg.select("g.data");
                var lines = data.selectAll("path").data(RX_plot_data, function(d, i) { return i; });
                var newLines = lines.enter().append("path").attr("class", "line");
                lines.attr('d', line);

                samples++;
            }

            // timer initialization
            GUI.interval_remove('receiver_pull');

            // enable RC data pulling
            GUI.interval_add('receiver_pull', get_rc_data, plot_update_rate, true);
        });

        // status data pulled via separate timer with static speed
        GUI.interval_add('status_pull', function() {
            send_message(MSP_codes.MSP_STATUS);
        }, 250, true);
    }
}
