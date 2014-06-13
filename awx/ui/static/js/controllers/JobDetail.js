/************************************
 * Copyright (c) 2014 AnsibleWorks, Inc.
 *
 *  JobDetail.js
 *
 */

'use strict';

function JobDetailController ($scope, $compile, $routeParams, $log, ClearScope, Breadcrumbs, LoadBreadCrumbs, GetBasePath, Wait, Rest, ProcessErrors, DigestEvents,
    SelectPlay, SelectTask, Socket, GetElapsed, SelectHost, FilterAllByHostName, DrawGraph, LoadHostSummary, ReloadHostSummaryList) {

    ClearScope();

    var job_id = $routeParams.id,
        event_socket,
        event_queue = [],
        scope = $scope,
        api_complete = false,
        refresh_count = 0,
        lastEventId = 0;

    scope.plays = {};
    scope.tasks = {};
    scope.hosts = [];
    scope.hostResults = [];
    scope.hostResultsMap = {};
    scope.hostsMap = {};

    scope.search_all_tasks = [];
    scope.search_all_plays = [];
    scope.job_status = {};
    scope.job_id = job_id;
    scope.auto_scroll = false;
    scope.searchTaskHostsEnabled = true;
    scope.searchSummaryHostsEnabled = true;
    scope.hostTableRows = 300;
    scope.hostSummaryTableRows = 300;
    scope.searchAllHostsEnabled = true;

    scope.host_summary = {};
    scope.host_summary.ok = 0;
    scope.host_summary.changed = 0;
    scope.host_summary.unreachable = 0;
    scope.host_summary.failed = 0;
    scope.host_summary.total = 0;

    scope.eventsHelpText = "<p><i class=\"fa fa-circle successful-hosts-color\"></i> Successful</p>\n" +
        "<p><i class=\"fa fa-circle changed-hosts-color\"></i> Changed</p>\n" +
        "<p><i class=\"fa fa-circle unreachable-hosts-color\"></i> Unreachable</p>\n" +
        "<p><i class=\"fa fa-circle failed-hosts-color\"></i> Failed</p>\n" +
        "<div class=\"popover-footer\"><span class=\"key\">esc</span> or click to close</div>\n";

    event_socket =  Socket({
        scope: scope,
        endpoint: "job_events"
    });

    event_socket.init();

    event_socket.on("job_events-" + job_id, function(data) {
        data.event = data.event_name;
        $log.debug('push event: ' + data.id);
        event_queue.push(data);

       /* if (api_complete && data.id > lastEventId) {
            // api loading is complete, process incoming events
        }
        else {
            // Waiting on values from the api to load. Until then queue incoming events.
        } */
    });

    if (scope.removeAPIComplete) {
        scope.removeAPIComplete();
    }
    scope.removeAPIComplete = scope.$on('APIComplete', function() {
        // process any events sitting in the queue
        var url, hostId = 0, taskId = 0, playId = 0;

        function notEmpty(x) {
            return Object.keys(x).length > 0;
        }

        function getMaxId(x) {
            var keys = Object.keys(x);
            keys.sort();
            return keys[keys.length - 1];
        }

        // Find the max event.id value in memory
        if (notEmpty(scope.hostResults)) {
            hostId = getMaxId(scope.hostResults);
        }
        else if (notEmpty(scope.tasks)) {
            taskId = getMaxId(scope.tasks);
        }
        else if (notEmpty(scope.plays)) {
            playId = getMaxId(scope.plays);
        }
        lastEventId = Math.max(hostId, taskId, playId);

        // Only process queued events > the max event in memory
        /*if (event_queue.length > 0) {
            event_queue.forEach(function(event) {
                if (event.id > lastEventId) {
                    events.push(event);
                }
            });
            if (events.length > 0) {
                DigestEvents({
                    scope: scope,
                    events: events
                });
            }
        }*/

        DigestEvents({
            scope: scope,
            queue: event_queue,
            lastEventId: lastEventId
        });

        api_complete = true;

        // Draw the graph
        if (scope.job.status === 'successful' || scope.job.status === 'failed' || scope.job.status === 'error') {
            // The job has already completed. graph values found on playbook stats
            url = scope.job.related.job_events + '?event=playbook_on_stats';
            Rest.setUrl(url);
            Rest.get()
                .success(function(data) {
                    if (data.count > 0) {
                        LoadHostSummary({
                            scope: scope,
                            data: data.results[0].event_data
                        });
                        DrawGraph({ scope: scope, resize: true });
                        Wait('stop');
                    }
                })
                .error(function(data, status) {
                    ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                        msg: 'Call to ' + url + '. GET returned: ' + status });
                });
        }
        else {
            // Draw the graph based on summary values in memory
            Wait('stop');
            DrawGraph({ scope: scope, resize: true });
        }
    });

    if (scope.removeInitialDataLoaded) {
        scope.removeInitialDataLoaded();
    }
    scope.removeInitialDataLoaded = scope.$on('InitialDataLoaded', function() {
        // Load data for the host summary table
        if (!api_complete) {
            ReloadHostSummaryList({
                scope: scope,
                callback: 'APIComplete'
            });
        }
    });

    if (scope.removePlaysReady) {
        scope.removePlaysReady();
    }
    scope.removePlaysReady = scope.$on('PlaysReady', function() {
        // Select the most recent play, which will trigger tasks and hosts to load
        var ids = Object.keys(scope.plays),
            lastPlay = (ids.length > 0) ? ids[ids.length - 1] : null;
        SelectPlay({
            scope: scope,
            id: lastPlay,
            callback: 'InitialDataLoaded'
        });
    });

    if (scope.removeJobReady) {
        scope.removeJobReady();
    }
    scope.removeJobReady = scope.$on('JobReady', function(e, events_url) {
        // Job finished loading. Now get the set of plays
        var url = scope.job.url  + 'job_plays/?order_by=id';
        Rest.setUrl(url);
        Rest.get()
            .success( function(data) {
                data.forEach(function(event, idx) {
                    var status = (event.failed) ? 'failed' : (event.changed) ? 'changed' : 'none',
                        start = event.started,
                        end,
                        elapsed;
                    if (idx < data.length - 1) {
                        // end date = starting date of the next event
                        end = data[idx + 1].started;
                    }
                    else if (scope.job_status.status === 'successful' || scope.job_status.status === 'failed' ||
                        scope.job_status.status === 'error' || scope.job_status.status === 'canceled') {
                        // this is the last play and the job already finished
                        end = scope.job_status.finished;
                    }
                    if (end) {
                        elapsed = GetElapsed({
                            start: start,
                            end: end
                        });
                    }
                    else {
                        elapsed = '00:00:00';
                    }
                    scope.plays[event.id] = {
                        id: event.id,
                        name: event.play,
                        created: start,
                        finished: end,
                        status: status,
                        elapsed: elapsed,
                        playActiveClass: ''
                    };
                    scope.host_summary.ok += data.ok_count;
                    scope.host_summary.changed += data.changed_count;
                    scope.host_summary.unreachable += (data.unreachable_count) ? data.unreachable_count : 0;
                    scope.host_summary.failed += data.failed_count;
                    scope.host_summary.total = scope.host_summary.ok + scope.host_summary.changed +
                        scope.host_summary.unreachable + scope.host_summary.failed;
                });

                scope.$emit('PlaysReady', events_url);
            })
            .error( function(data, status) {
                ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                    msg: 'Call to ' + url + '. GET returned: ' + status });
            });
    });


    if (scope.removeGetCredentialNames) {
        scope.removeGetCredentialNames();
    }
    scope.removeGetCredentialNames = scope.$on('GetCredentialNames', function(e, data) {
        var url;
        if (data.credential) {
            url = GetBasePath('credentials') + data.credential + '/';
            Rest.setUrl(url);
            Rest.get()
                .success( function(data) {
                    scope.credential_name = data.name;
                })
                .error( function(data, status) {
                    scope.credential_name = '';
                    ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                        msg: 'Call to ' + url + '. GET returned: ' + status });
                });
        }
        if (data.cloud_credential) {
            url = GetBasePath('credentials') + data.credential + '/';
            Rest.setUrl(url);
            Rest.get()
                .success( function(data) {
                    scope.cloud_credential_name = data.name;
                })
                .error( function(data, status) {
                    scope.credential_name = '';
                    ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                        msg: 'Call to ' + url + '. GET returned: ' + status });
                });
        }
    });


    if (scope.removeLoadJob) {
        scope.removeLoadJob();
    }
    scope.removeLoadJobRow = scope.$on('LoadJob', function() {
        Wait('start');
        // Load the job record
        Rest.setUrl(GetBasePath('jobs') + job_id + '/');
        Rest.get()
            .success(function(data) {
                scope.job = data;
                scope.job_template_name = data.name;
                scope.project_name = (data.summary_fields.project) ? data.summary_fields.project.name : '';
                scope.inventory_name = (data.summary_fields.inventory) ? data.summary_fields.inventory.name : '';
                scope.job_template_url = '/#/job_templates/' + data.unified_job_template;
                scope.inventory_url = (scope.inventory_name && data.inventory) ? '/#/inventories/' + data.inventory : '';
                scope.project_url = (scope.project_name && data.project) ? '/#/projects/' + data.project : '';
                scope.job_type = data.job_type;
                scope.playbook = data.playbook;
                scope.credential = data.credential;
                scope.cloud_credential = data.cloud_credential;
                scope.forks = data.forks;
                scope.limit = data.limit;
                scope.verbosity = data.verbosity;
                scope.job_tags = data.job_tags;

                // In the case that the job is already completed, or an error already happened,
                // populate scope.job_status info
                scope.job_status.status = (data.status === 'waiting' || data.status === 'new') ? 'pending' : data.status;
                scope.job_status.started = data.started;
                scope.job_status.status_class = ((data.status === 'error' || data.status === 'failed') && data.job_explanation) ? "alert alert-danger" : "";
                scope.job_status.finished = data.finished;
                scope.job_status.explanation = data.job_explanation;

                if (data.started && data.finished) {
                    scope.job_status.elapsed = GetElapsed({
                        start: data.started,
                        end: data.finished
                    });
                }
                else {
                    scope.job_status.elapsed = '00:00:00';
                }

                scope.setSearchAll('host');
                scope.$emit('JobReady', data.related.job_events);
                scope.$emit('GetCredentialNames', data);
            })
            .error(function(data, status) {
                ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                    msg: 'Failed to retrieve job: ' + $routeParams.id + '. GET returned: ' + status });
            });
    });

    if (scope.removeRefreshCompleted) {
        scope.removeRefreshCompleted();
    }
    scope.removeRefreshCompleted = scope.$on('RefreshCompleted', function() {
        refresh_count++;
        if (refresh_count === 1) {
            // First time. User just loaded page.
            scope.$emit('LoadJob');
        }
        else {
            // Check if we need to redraw the group
            setTimeout(function() { DrawGraph({ scope: scope, resize: true }); }, 500);
        }
    });

    scope.adjustSize = function() {
        var height, ww = $(window).width();
        if (ww < 1240) {
            $('#job-summary-container').hide();
            $('#job-detail-container').css({ "width": "100%", "padding-right": "15px" });
            $('#summary-button').show();
        }
        else {
            $('.overlay').hide();
            $('#summary-button').hide();
            $('#hide-summary-button').hide();
            $('#job-detail-container').css({ "width": "58.33333333%", "padding-right": "7px" });
            $('#job-summary-container .job_well').css({
                'box-shadow': 'none',
                'height': 'auto'
            });
            $('#job-summary-container').css({
                "width": "41.66666667%",
                "padding-left": "7px",
                "padding-right": "15px",
                "z-index": 0
            });
            setTimeout(function() { $('#job-summary-container .job_well').height($('#job-detail-container').height() - 18); }, 500);
            $('#job-summary-container').show();
        }
        // Detail table height adjusting. First, put page height back to 'normal'.
        $('#plays-table-detail').height(150);
        $('#plays-table-detail').mCustomScrollbar("update");
        $('#tasks-table-detail').height(150);
        $('#tasks-table-detail').mCustomScrollbar("update");
        $('#hosts-table-detail').height(150);
        $('#hosts-table-detail').mCustomScrollbar("update");
        height = $('#wrap').height() - $('.site-footer').outerHeight() - $('.main-container').height();
        if (height > 15) {
            // there's a bunch of white space at the bottom, let's use it
            $('#plays-table-detail').height(150 + (height / 3));
            $('#plays-table-detail').mCustomScrollbar("update");
            $('#tasks-table-detail').height(150 + (height / 3));
            $('#tasks-table-detail').mCustomScrollbar("update");
            $('#hosts-table-detail').height(150 + (height / 3));
            $('#hosts-table-detail').mCustomScrollbar("update");
        }
        // Summary table height adjusting.
        height = ($('#job-detail-container').height() / 2) - $('#hosts-summary-section .header').outerHeight() -
            $('#hosts-summary-section .table-header').outerHeight() -
            $('#summary-search-section').outerHeight() - 20;
        $('#hosts-summary-table').height(height);
        $('#hosts-summary-table').mCustomScrollbar("update");
        scope.$emit('RefreshCompleted');
    };

    setTimeout(function() { scope.adjustSize(); }, 500);

    // Use debounce for the underscore library to adjust after user resizes window.
    $(window).resize(_.debounce(function(){
        scope.adjustSize();
    }, 500));

    scope.setSearchAll = function(search) {
        if (search === 'host') {
            scope.search_all_label = 'Host';
            scope.searchAllDisabled = false;
            scope.search_all_placeholder = 'Search all by host name';
        }
        else {
            scope.search_all_label = 'Failures';
            scope.search_all_placeholder = 'Show failed events';
            scope.searchAllDisabled = true;
            scope.search_all_placeholder = '';
        }
    };

    scope.selectPlay = function(id) {
        SelectPlay({
            scope: scope,
            id: id
        });
    };

    scope.selectTask = function(id) {
        SelectTask({
            scope: scope,
            id: id
        });
    };

    scope.toggleSummary = function(hide) {
        var docw, doch, height = $('#job-detail-container').height(), slide_width;
        if (!hide) {
            docw = $(window).width();
            doch = $(window).height();
            slide_width = (docw < 840) ? '100%' : '80%';
            $('#summary-button').hide();
            $('.overlay').css({
                width: $(document).width(),
                height: $(document).height()
            }).show();

            // Adjust the summary table height
            $('#job-summary-container .job_well').height(height - 18).css({
                'box-shadow': '-3px 3px 5px 0 #ccc'
            });
            height = Math.floor($('#job-detail-container').height() * 0.5) -
                $('#hosts-summary-section .header').outerHeight() -
                $('#hosts-summary-section .table-header').outerHeight() -
                $('#hide-summary-button').outerHeight() -
                $('#summary-search-section').outerHeight() -
                $('#hosts-summary-section .header').outerHeight() -
                $('#hosts-summary-section .legend').outerHeight();
            $('#hosts-summary-table').height(height - 50);
            $('#hosts-summary-table').mCustomScrollbar("update");

            $('#hide-summary-button').show();

            $('#job-summary-container').css({
                top: 0,
                right: 0,
                width: slide_width,
                'z-index': 2000,
                'padding-right': '15px',
                'padding-left': '15px'
            }).show('slide', {'direction': 'right'});

            setTimeout(function() { DrawGraph({ scope: scope, resize: true }); }, 500);
        }
        else {
            $('.overlay').hide();
            $('#summary-button').show();
            $('#job-summary-container').hide('slide', {'direction': 'right'});
        }
    };

    scope.objectIsEmpty = function(obj) {
        return (Object.keys(obj).length > 0) ? false : true;
    };

    scope.HostDetailOnTotalScroll = _.debounce(function() {
        // Called when user scrolls down (or forward in time). Using _.debounce
        var url, mcs = arguments[0];
        scope.$apply(function() {
            if (!scope.auto_scroll && scope.activeTask && scope.hostResults.length) {
                scope.auto_scroll = true;
                url = GetBasePath('jobs') + job_id + '/job_events/?parent=' + scope.activeTask + '&';
                url += (scope.search_all_hosts_name) ? 'host__name__icontains=' + scope.search_all_hosts_name + '&' : '';
                url += (scope.searchAllStatus === 'failed') ? 'failed=true&' : '';
                url += 'host__name__gt=' + scope.hostResults[scope.hostResults.length - 1].name + '&host__isnull=false&page_size=' + (scope.hostTableRows / 3) + '&order_by=host__name';
                Wait('start');
                Rest.setUrl(url);
                Rest.get()
                    .success(function(data) {
                        data.results.forEach(function(row) {
                            scope.hostResults.push({
                                id: row.id,
                                status: ( (row.failed) ? 'failed': (row.changed) ? 'changed' : 'successful' ),
                                host_id: row.host,
                                task_id: row.parent,
                                name: row.event_data.host,
                                created: row.created,
                                msg: ( (row.event_data && row.event_data.res) ? row.event_data.res.msg : '' )
                            });
                            if (scope.hostResults.length > scope.hostTableRows) {
                                scope.hostResults.splice(0,1);
                            }
                        });
                        if (data.next) {
                            // there are more rows. move dragger up, letting user know.
                            setTimeout(function() { $('#hosts-table-detail .mCSB_dragger').css({ top: (mcs.draggerTop - 15) + 'px'}); }, 700);
                        }
                        scope.auto_scroll = false;
                        Wait('stop');
                    })
                    .error(function(data, status) {
                        ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                            msg: 'Call to ' + url + '. GET returned: ' + status });
                    });
            }
            else {
                scope.auto_scroll = false;
            }
        });
    }, 300);

    scope.HostDetailOnTotalScrollBack = _.debounce(function() {
        // Called when user scrolls up (or back in time)
        var url, mcs = arguments[0];
        scope.$apply(function() {
            if (!scope.auto_scroll && scope.activeTask && scope.hostResults.length) {
                scope.auto_scroll = true;
                url = GetBasePath('jobs') + job_id + '/job_events/?parent=' + scope.activeTask + '&';
                url += (scope.search_all_hosts_name) ? 'host__name__icontains=' + scope.search_all_hosts_name + '&' : '';
                url += (scope.searchAllStatus === 'failed') ? 'failed=true&' : '';
                url += 'host__name__lt=' + scope.hostResults[0].name + '&host__isnull=false&page_size=' + (scope.hostTableRows / 3) + '&order_by=-host__name';
                Wait('start');
                Rest.setUrl(url);
                Rest.get()
                    .success(function(data) {
                        data.results.forEach(function(row) {
                            scope.hostResults.unshift({
                                id: row.id,
                                status: ( (row.failed) ? 'failed': (row.changed) ? 'changed' : 'successful' ),
                                host_id: row.host,
                                task_id: row.parent,
                                name: row.event_data.host,
                                created: row.created,
                                msg: ( (row.event_data && row.event_data.res) ? row.event_data.res.msg : '' )
                            });
                            if (scope.hostResults.length > scope.hostTableRows) {
                                scope.hostResults.pop();
                            }
                        });
                        if (data.next) {
                            // there are more rows. move dragger down, letting user know.
                            setTimeout(function() { $('#hosts-table-detail .mCSB_dragger').css({ top: (mcs.draggerTop + 15) + 'px' }); }, 700);
                        }
                        Wait('stop');
                        scope.auto_scroll = false;
                    })
                    .error(function(data, status) {
                        ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                            msg: 'Call to ' + url + '. GET returned: ' + status });
                    });
            }
            else {
                scope.auto_scroll = false;
            }
        });
    }, 300);

    scope.HostSummaryOnTotalScroll = function(mcs) {
        var url;
        if (!scope.auto_scroll && scope.hosts) {
            url = GetBasePath('jobs') + job_id + '/job_host_summaries/?';
            url += (scope.search_all_hosts_name) ? 'host__name__icontains=' + scope.search_all_hosts_name + '&' : '';
            url += (scope.searchAllStatus === 'failed') ? 'failed=true&' : '';
            url += 'host__name__gt=' + scope.hosts[scope.hosts.length - 1].name + '&page_size=' + (scope.hostSummaryTableRows / 3) + '&order_by=host__name';
            Wait('start');
            Rest.setUrl(url);
            Rest.get()
                .success(function(data) {
                    setTimeout(function() {
                        scope.$apply(function() {
                            data.results.forEach(function(row) {
                                scope.hosts.push({
                                    id: row.host,
                                    name: row.summary_fields.host.name,
                                    ok: row.ok,
                                    changed: row.changed,
                                    unreachable: row.dark,
                                    failed: row.failures
                                });
                                if (scope.hosts.length > scope.hostSummaryTableRows) {
                                    scope.hosts.splice(0,1);
                                }
                            });
                            if (data.next) {
                                // there are more rows. move dragger up, letting user know.
                                setTimeout(function() { $('#hosts-summary-table .mCSB_dragger').css({ top: (mcs.draggerTop - 15) + 'px'}); }, 700);
                            }
                        });
                    }, 100);
                    Wait('stop');
                })
                .error(function(data, status) {
                    ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                        msg: 'Call to ' + url + '. GET returned: ' + status });
                });
        }
        else {
            scope.auto_scroll = false;
        }
    };

    scope.HostSummaryOnTotalScrollBack = function(mcs) {
        var url;
        if (!scope.auto_scroll && scope.hosts) {
            url = GetBasePath('jobs') + job_id + '/job_host_summaries/?';
            url += (scope.search_all_hosts_name) ? 'host__name__icontains=' + scope.search_all_hosts_name + '&' : '';
            url += (scope.searchAllStatus === 'failed') ? 'failed=true&' : '';
            url += 'host__name__lt=' + scope.hosts[0].name + '&page_size=' + (scope.hostSummaryTableRows / 3) + '&order_by=-host__name';
            Wait('start');
            Rest.setUrl(url);
            Rest.get()
                .success(function(data) {
                    setTimeout(function() {
                        scope.$apply(function() {
                            data.results.forEach(function(row) {
                                scope.hosts.unshift({
                                    id: row.host,
                                    name: row.summary_fields.host.name,
                                    ok: row.ok,
                                    changed: row.changed,
                                    unreachable: row.dark,
                                    failed: row.failures
                                });
                                if (scope.hosts.length > scope.hostSummaryTableRows) {
                                    scope.hosts.pop();
                                }
                            });
                            if (data.next) {
                                // there are more rows. move dragger down, letting user know.
                                setTimeout(function() { $('#hosts-summary-table .mCSB_dragger').css({ top: (mcs.draggerTop + 15) + 'px' }); }, 700);
                            }
                        });
                    }, 100);
                    Wait('stop');
                })
                .error(function(data, status) {
                    ProcessErrors(scope, data, status, null, { hdr: 'Error!',
                        msg: 'Call to ' + url + '. GET returned: ' + status });
                });
        }
        else {
            scope.auto_scroll = false;
        }
    };

    scope.searchAllByHost = function() {
        var nxtPlay;
        if (scope.search_all_hosts_name) {
            FilterAllByHostName({
                scope: scope,
                host: scope.search_all_hosts_name
            });
            scope.searchAllHostsEnabled = false;
        }
        else {
            scope.search_all_tasks = [];
            scope.search_all_plays = [];
            scope.searchAllHostsEnabled = true;
            nxtPlay = scope.plays[scope.plays.length - 1].id;
            SelectPlay({
                scope: scope,
                id: nxtPlay
            });
            ReloadHostSummaryList({
                scope: scope
            });
            //setTimeout(function() {
            //    SelectPlay({ scope: scope, id: scope.activePlay });
            //}, 2000);
        }
    };

    scope.allHostNameKeyPress = function(e) {
        if (e.keyCode === 13) {
            scope.searchAllByHost();
        }
    };

    scope.filterByStatus = function(choice) {
        var key, keys, nxtPlay;
        if (choice === 'Failed') {
            scope.searchAllStatus = 'failed';
            for(key in scope.plays) {
                if (scope.plays[key].status === 'failed') {
                    nxtPlay = key;
                }
            }
        }
        else {
            scope.searchAllStatus = '';
            keys = Object.keys(scope.plays);
            nxtPlay = (keys.length > 0) ? keys[keys.length - 1] : null;
        }
        SelectPlay({
            scope: scope,
            id: nxtPlay
        });
        ReloadHostSummaryList({
            scope: scope
        });
        //setTimeout(function() {
        //    SelectPlay({ scope: scope, id: scope.activePlay });
        //}, 2000);
    };

    scope.viewEvent = function(event_id) {
        $log.debug(event_id);
    };

}

JobDetailController.$inject = [ '$scope', '$compile', '$routeParams', '$log', 'ClearScope', 'Breadcrumbs', 'LoadBreadCrumbs', 'GetBasePath', 'Wait',
    'Rest', 'ProcessErrors', 'DigestEvents', 'SelectPlay', 'SelectTask', 'Socket', 'GetElapsed', 'SelectHost', 'FilterAllByHostName', 'DrawGraph',
    'LoadHostSummary', 'ReloadHostSummaryList'
];
