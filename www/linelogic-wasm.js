// LineLogic 2 WASM
// Copyright Ashley Newson 2020

var version_string = "1.0"

import init, { CellBits as Cell, Circuit } from './pkg/linelogic_wasm.js';

const signal_shift = 4;


let circuit;
let wasm;


let canvas;
let ctx;
let now;
let then;
let running;
let width;
let height;
let scale;
let full_render = true;
let full_update = true;
let goals = Array(0);
let clipboard_cells = Array(0);
let clipboard_width = 0;
let clipboard_height = 0;
let update_count = 0;
let update_x;
let update_y;
let new_update_count = 0;
let new_update_x;
let new_update_y;
let speed = 0;
let slow_count = 0;

let input_speed;

let mode_wire;
let mode_protect;
let mode_wire_force;
let mode_goal;

let goal_ignore;
let goal_all;
let goal_any;
let goal_change;
let goal_mode;

let executionStatus;
let it_acc;

let mouse = {x:0, y:0};
let mouse_start = {x:0, y:0};
let keys_down = {};



async function run() {
    wasm = await init();

    circuit = Circuit.new(16, 16);
    window.circuit = circuit; // For debugging
    window.Cell = Cell; // For debugging

    input_speed = document.getElementById('input_speed');

    mode_wire = document.getElementById("mode_wire");
    mode_protect = document.getElementById("mode_protect");
    mode_wire_force = document.getElementById("mode_wire_force");
    mode_goal = document.getElementById("mode_goal");

    goal_ignore = document.getElementById("goal_ignore");
    goal_all = document.getElementById("goal_all");
    goal_any = document.getElementById("goal_any");
    goal_change = document.getElementById("goal_change");

    document.getElementById("version").innerHTML = "Version: " + version_string;
    const logic_div = document.getElementById("logic-area");
    canvas = document.createElement("canvas");
    ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.webkitImageSmoothingEnabled = false;
    ctx.mozImageSmoothingEnabled = false;
    set_size();
    set_speed();
    logic_div.appendChild(canvas);

    it_acc = 0;
    executionStatus = document.getElementById("status");
}
run();



function ascii (a) { return a.charCodeAt(0); }

let key_bindings = {
    guard : ascii("G"), // used to guard dangerous actions.

    reset : ascii("R"),

    pause : ascii(" "),
    slower : 219,
    faster : 221,

    mode_wire : ascii("1"),
    mode_protect : ascii("2"),
    mode_wire_force : ascii("3"),
    mode_goal : ascii("4"),

    subtract : ascii("D"),
    copy : ascii("C"),
    cut : ascii("X"),
    erase : ascii("E"),
    paste : ascii("V"),
    additive_paste : ascii("B"),
    flip_v : ascii("I"),
    flip_h : ascii("K"),
    rotate_ccw : ascii("J"),
    rotate_cw : ascii("L"),
};


function render() {
    const cellsPtr = circuit.cells_ptr();
    const cells = new Uint8Array(wasm.memory.buffer, cellsPtr, width * height);

    const cell = (x, y) => {
        return cells[y*width+x]
    };

    if (full_render) {
        // Clear screen
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (((x % 2) ^ (y % 2)) === 1) {
                    if (cell(x,y) & Cell.Protected) {
                        ctx.fillStyle = "rgb(32, 128, 32)";
                    } else {
                        ctx.fillStyle = "rgb(32, 32, 32)";
                    }
                    ctx.fillRect(x, y, 1, 1);
                } else {
                    if (cell(x,y) & Cell.Protected) {
                        ctx.fillStyle = "rgb(0, 128, 0)";
                    } else {
                        ctx.fillStyle = "rgb(0, 0, 0)";
                    }
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
        full_render = false;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (cell(x,y) & Cell.Wire) {
                if (cell(x,y) & Cell.Signal) {
                    ctx.fillStyle = "rgb(255, " + ((cell(x,y) & Cell.Protected) ? '255' : '128') + ", " + ((cell(x,y) >> signal_shift) & 0xf) + ")";
                    ctx.fillRect(x, y, 1, 1);
                } else {
                    ctx.fillStyle = "rgb(0, " + ((cell(x,y) & Cell.Protected) ? '255' : '128') + ", 255)";
                    ctx.fillRect(x, y, 1, 1);
                }
            }
        }
    }

    var i;
    for (i = 0; i < goals.length; i++) {
        var x = goals[i].x;
        var y = goals[i].y;
        if (cell(x,y) & Cell.Signal) {
            ctx.fillStyle = "rgb(255, 0, " + ((cell(x,y) >> signal_shift) & 0xf) + ")";
            ctx.fillRect(x, y, 1, 1);
        } else {
            ctx.fillStyle = "rgb(128, 0, 0)";
            ctx.fillRect(x, y, 1, 1);
        }
    }

    if (keys_down[key_bindings.paste] || keys_down[key_bindings.additive_paste]) {
        for (y = 0; y < clipboard_height; y++) {
            for (x = 0; x < clipboard_width; x++) {
                if (clipboard_cells[y][x] & 1) {
                    if (clipboard_cells[y][x] & 30) {
                        ctx.fillStyle = "rgb(255, " + ((circuit.get_cell(x,y) & Cell.Protected) ? '255' : '192') + ", " + ((circuit.get_cell(x,y) >> signal_shift) & 0xf) + ")";
                        ctx.fillRect(x + mouse.x, y + mouse.y, 1, 1);
                    } else {
                        ctx.fillStyle = "rgb(64, " + ((circuit.get_cell(x,y) & Cell.Protected) ? '255' : '192') + ", 255)";
                        ctx.fillRect(x + mouse.x, y + mouse.y, 1, 1);
                    }
                } else if (keys_down[key_bindings.paste]) {
                    ctx.fillStyle = "rgb(64, 64, 64)";
                    ctx.fillRect(x + mouse.x, y + mouse.y, 1, 1);
                }
            }
        }
        full_render = true;
    }
}

function update() {
    let max_iterations = 1;
    if (speed < 0) {
        if (speed > -120) {
            max_iterations = parseInt(120 / (parseInt(speed)+120));
        } else {
            max_iterations = -1;
        }
    } else {
        if (slow_count < speed) {
            slow_count++;
            return;
        } else {
            slow_count = 0;
        }
    }

    let achieved = false;

    if (goal_ignore.checked) {
        goal_mode = "ignore";
    } else if (goal_all.checked) {
        goal_mode = "all";
    } else if (goal_any.checked) {
        goal_mode = "any";
    } else if (goal_change.checked) {
        goal_mode = "change";
    }

    let it;
    let start_time = Date.now();
    for (it = 0; it != max_iterations; it++) {
        circuit.tick();

        {
            if (goal_mode === "all") {
                achieved = (goals.length > 0);
                for (let i = 0; i < goals.length; i++) {
                    if ((circuit.get_cell(goals[i].x, goals[i].y) & Cell.Signal) === 0) {
                        achieved = false;
                        break;
                    }
                }
            } else if (goal_mode === "any") {
                achieved = false;
                for (let i = 0; i < goals.length; i++) {
                    if (circuit.get_cell(goals[i].x, goals[i].y) & Cell.Signal) {
                        achieved = true;
                        break;
                    }
                }
            } else if (goal_mode === "change") {
                achieved = false;
                for (let i = 0; i < goals.length; i++) {
                    if (circuit.get_cell(goals[i].x, goals[i].y) != (goals[i].last || 1)) {
                        achieved = true;
                        break;
                    }
                }
            }

            for (let i = 0; i < goals.length; i++) {
                goals[i].last = circuit.get_cell(goals[i].x, goals[i].y);
            }
        }
        if (achieved) {
            it++; // For it counting.
            break;
        }

        let current_time = Date.now();
        if (current_time - start_time > 1) {
            it++; // For it counting.
            break;
        }
    }
    render();

    it_acc += it;
    if (achieved === true) {
        executionStatus.innerHTML = "Complete:<br>Iteration count: " + it_acc;
        stop();
    } else {
        executionStatus.innerHTML = "Running:<br>Cycles per frame: " + it + "<br>out of target: " + max_iterations + "<br>Iteration count: " + it_acc;
    }
}


const main_loop = function() {
    if (running) {
        update();

        then = now;

        requestAnimationFrame(main_loop);
    } else {
        executionStatus.innerHTML = "Stopped" + "<br>Iteration count: " + it_acc;
    }
}

var display_loop = function() {
    if (!running && (keys_down[key_bindings.paste] || keys_down[key_bindings.additive_paste])) {
        render();
        requestAnimationFrame(display_loop);
    }
}


function toggle_cell(x, y, force) {
    if (x >= 1 && x < width-1 && y >= 1 && y < height-1) {
        if (!(circuit.get_cell(x,y) & Cell.Protected)) {
            if ((circuit.get_cell(x,y) & Cell.Wire) === 0) {
                circuit.add_to_cell(x,y, Cell.Wire);
            } else {
                circuit.sub_from_cell(x,y, Cell.Material);
            }
            full_render = true;
            render();
            full_update = true;
        } else if (force) {
            if (circuit.get_cell(x,y) === 0) {
                circuit.add_to_cell(x,y, Cell.Wire);
            } else {
                circuit.sub_from_cell(x,y, Cell.Material);
                for (let i = 0; i < goals.length; i++) {
                    if (goals[i].x === x && goals[i].y === y) {
                        goals.splice(i, 1);
                        circuit.sub_from_cell(x,y, Cell.Goal);
                        break;
                    }
                }
            }
            full_render = true;
            render();
            full_update = true;
        }
    }
}

function line_cell(x1, y1, x2, y2, set_to, force) {
    if (x1 >= 1 && x1 < width-1 && y1 >= 1 && y1 < height-1 &&
        x2 >= 1 && x2 < width-1 && y2 >= 1 && y2 < height-1) {
        const mx = Math.abs(x2 - x1);
        const my = Math.abs(y2 - y1);
        const ox1 = (x1 < x2) ? x1 : x2;
        const ox2 = (x1 < x2) ? x2 : x1;
        const oy1 = (y1 < y2) ? y1 : y2;
        const oy2 = (y1 < y2) ? y2 : y1;
        if (mx >= my) {
            for (let x = ox1; x <= ox2; x++) {
                edit_cell(x, y1, set_to, force);
            }
            for (let y = oy1; y <= oy2; y++) {
                edit_cell(x2, y, set_to, force);
            }
        } else {
            for (let y = oy1; y <= oy2; y++) {
                edit_cell(x1, y, set_to, force);
            }
            for (let x = ox1; x <= ox2; x++) {
                edit_cell(x, y2, set_to, force);
            }
        }
    }
}

function edit_cell(x, y, set_to, force) {
    const is_protected = !!(circuit.get_cell(x,y) & Cell.Protected);
    if (!is_protected || force) {
        if (set_to) {
            circuit.add_to_cell(x,y, Cell.Wire);
        } else {
            circuit.sub_from_cell(x,y, Cell.Wire | Cell.Goal | Cell.Signal);
        }
    }
    if (is_protected && force && set_to === false) {
        for (let i = 0; i < goals.length; i++) {
            if (goals[i].x === x && goals[i].y === y) {
                goals.splice(i, 1);
                circuit.sub_from_cell(x,y, Cell.Goal);
                break;
            }
        }
    }
    full_render = true;
    full_update = true;
}

function toggle_protect(x, y) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
        let i;
        for (i = 0; i < goals.length; i++) {
            if (goals[i].x === x && goals[i].y === y) {
                break;
            }
        }
        if (i === goals.length) { // If not a goal.
            circuit.toggle_in_cell(x,y, Cell.Protected);
        }
        full_render = true;
    }
}

function box_protect(x1, y1, x2, y2, set_to) {
    if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height &&
        x2 >= 0 && x2 < width && y2 >= 0 && y2 < height) {
        if (x1 > x2) {
            const tmp = x1; x1 = x2; x2 = tmp;
        }
        if (y1 > y2) {
            const tmp = y1; y1 = y2; y2 = tmp;
        }
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                let i;
                for (i = 0; i < goals.length; i++) {
                    if (goals[i].x === x && goals[i].y === y) {
                        break;
                    }
                }
                if (i === goals.length) { // If not a goal.
                    circuit.set_in_cell(x,y, Cell.Protected, set_to);
                }
            }
        }
        full_render = true;
    }
}

function box_copy(x1, y1, x2, y2) {
    if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height &&
        x2 >= 0 && x2 < width && y2 >= 0 && y2 < height) {
        if (x1 > x2) {
            const tmp = x1; x1 = x2; x2 = tmp;
        }
        if (y1 > y2) {
            const tmp = y1; y1 = y2; y2 = tmp;
        }
        resize_2d(clipboard_cells, clipboard_width, clipboard_height, x2 - x1 + 1, y2 - y1 + 1);
        clipboard_width = x2 - x1 + 1;
        clipboard_height = y2 - y1 + 1;
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                clipboard_cells[y - y1][x - x1] = circuit.get_cell(x,y);
            }
        }
        full_render = true;
    }
}

function box_erase(x1, y1, x2, y2) {
    if (x1 >= 0 && x1 < width && y1 >= 0 && y1 < height &&
        x2 >= 0 && x2 < width && y2 >= 0 && y2 < height) {
        if (x1 > x2) {
            const tmp = x1; x1 = x2; x2 = tmp;
        }
        if (y1 > y2) {
            const tmp = y1; y1 = y2; y2 = tmp;
        }
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                edit_cell(x, y, false, mode_wire_force.checked);
            }
        }
        full_render = true;
        full_update = true;
    }
}

function box_paste(x1, y1, additive) {
    if (x1 >= 1 && x1 < width && y1 >= 1 && y1 < height) {
        const x2 = x1 + clipboard_width - 1;
        const y2 = y1 + clipboard_height - 1;
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                if (x < width - 1 && y < height - 1) {
                    const is_protected = !!(circuit.get_cell(x,y) & Cell.Protected);
                    if (!is_protected || mode_wire_force.checked) {
                        if (additive) {
                            if (keys_down[key_bindings.subtract]) {
                                if (clipboard_cells[y - y1][x - x1] != 0) {
                                    circuit.sub_from_cell(x,y, Cell.Material);
                                }
                            } else {
                                circuit.add_to_cell(x,y, clipboard_cells[y - y1][x - x1] & Cell.Material);
                            }
                        } else {
                            circuit.sub_from_cell(x,y, Cell.Material);
                            circuit.add_to_cell(x,y, clipboard_cells[y - y1][x - x1] & Cell.Material);
                        }
                    } else if (is_protected && mode_wire_force.checked && (clipboard_cells[y - y1][x - x1] & Cell.Wire) === 0) {
                        for (let i = 0; i < goals.length; i++) {
                            if (goals[i].x === x && goals[i].y === y) {
                                goals.splice(i, 1);
                                circuit.sub_from_cell(x,y, Cell.Goal);
                                break;
                            }
                        }
                    }
                }
            }
        }
        full_render = true;
        full_update = true;
    }
}

function copy_2d(original) {
    const copy = Array(0);
    const height = original.length;
    const width = (height > 0) ? original[0].length : 0;
    resize_2d(copy, 0, 0, width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            copy[y][x] = original[y][x];
        }
    }
    return copy;
}

function clipboard_flip_h() {
    const old_clipboard_cells = copy_2d(clipboard_cells);
    for (let y = 0; y < clipboard_height; y++) {
        for (let x = 0; x < clipboard_width; x++) {
            clipboard_cells[y][x] = old_clipboard_cells[y][clipboard_width - x - 1];
        }
    }
}

function clipboard_flip_v() {
    const old_clipboard_cells = copy_2d(clipboard_cells);
    for (let y = 0; y < clipboard_height; y++) {
        for (let x = 0; x < clipboard_width; x++) {
            clipboard_cells[y][x] = old_clipboard_cells[clipboard_height - y - 1][x];
        }
    }
}

function clipboard_rotate_ccw() {
    const old_clipboard_cells = copy_2d(clipboard_cells);
    const old_clipboard_width = clipboard_width;
    const old_clipboard_height = clipboard_height;
    clipboard_width = old_clipboard_height;
    clipboard_height = old_clipboard_width;
    resize_2d(clipboard_cells, old_clipboard_width, old_clipboard_height, clipboard_width, clipboard_height);
    for (let y = 0; y < clipboard_height; y++) {
        for (let x = 0; x < clipboard_width; x++) {
            clipboard_cells[y][x] = old_clipboard_cells[x][old_clipboard_width - y - 1];
        }
    }
}

function clipboard_rotate_cw() {
    const old_clipboard_cells = copy_2d(clipboard_cells);
    const old_clipboard_width = clipboard_width;
    const old_clipboard_height = clipboard_height;
    clipboard_width = old_clipboard_height;
    clipboard_height = old_clipboard_width;
    resize_2d(clipboard_cells, old_clipboard_width, old_clipboard_height, clipboard_width, clipboard_height);
    for (let y = 0; y < clipboard_height; y++) {
        for (let x = 0; x < clipboard_width; x++) {
            clipboard_cells[y][x] = old_clipboard_cells[old_clipboard_height - x - 1][y];
        }
    }
}

function toggle_goal(x, y) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
        let i;
        for (i = 0; i < goals.length; i++) {
            if (goals[i].x === x && goals[i].y === y) {
                break;
            }
        }
        if (i === goals.length) {
            // Place
            goals.push({x: x, y: y});
            circuit.add_to_cell(x,y, Cell.Wire | Cell.Protected | Cell.Goal);
        } else {
            // Remove
            goals.splice(i, 1);
            circuit.sub_from_cell(x,y, Cell.Goal);
        }
        full_render = true;
        render();
        full_update = true;
    }
}


function stop() {
    running = false;
}

function start() {
    if (!running) {
        running = true;
        now = Date.now();
        then = now;
        for (let i = 0; i < goals.length; i++) {
            goals[i].last = circuit.get_cell(goals[i].x, goals[i].y);
        }
        main_loop();
    }
}

function reset() {
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            circuit.sub_from_cell(x,y, Cell.Signal);
        }
    }
    for (let i = 0; i < goals.length; i++) {
        goals[i].last = circuit.get_cell(goals[i].x, goals[i].y);
    }
    full_render = true;
    render();
    full_update = true;
    it_acc = 0;
    executionStatus.innerHTML = "Reset";
}

function clear(mode) {
    let protection = false;
    if (mode === "protection") {
        protection = true;
    } else if (mode === "goal") {
        goals = Array(0);
        render();
        full_update = true;
        return;
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (protection) {
                circuit.sub_from_cell(x,y, Cell.Protected);
            } else if ((circuit.get_cell(x,y) & Cell.Protected) === 0) {
                circuit.sub_from_cell(x,y, Cell.Material);
            }
        }
    }

    if (protection) {
        // Repair goals where protection was destroyed
        for (let i = 0; i < goals.length; i++) {
            circuit.add_to_cell(goals[i].x, goals[i].y, Cell.Protected);
        }
    }

    full_render = true;
    render();
    full_update = true;
}



function resize_2d(array, old_width, old_height, width, height) {
    if (height < old_height) {
        array.splice(height, old_height - height);
    } else if (height > old_height) {
        for (let y = old_height; y < height; y++) {
            array[y] = Array(width);
        }
    }
    if (width < old_width) {
        for (let y = 0; y < height; y++) {
            array[y].splice(width, old_width - width);
        }
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (typeof(array[y][x]) === "undefined") {
                array[y][x] = 0;
            }
        }
    }
}

function set_size() {
    const input_width = document.getElementById("input_width");
    const input_height = document.getElementById("input_height");
    const old_width  = width;
    const old_height = height;

    canvas.width  = width  = parseInt(input_width.value);
    canvas.height = height = parseInt(input_height.value);
    scale = parseInt(input_scale.value);
    canvas.style.width  = canvas.width * scale + "px";
    canvas.style.height = canvas.height * scale + "px";

    circuit.resize(width, height);

    const new_goals = Array(0);
    for (let i = 0; i < goals.length; i++) {
        if (goals[i].x < canvas.width - 1 && goals[i].y < canvas.height - 1) {
            new_goals.push(goals[i]);
        }
    }
    goals = new_goals;

    full_render = true;
    render();
    full_update = true;
}

function set_speed() {
    speed = input_speed.value;
}


addEventListener("keydown", function (e) {
    // These are exceptions to the anti-repeat guard.
    if (e.keyCode === key_bindings.faster) {
        input_speed.stepDown();
        set_speed();
    }
    if (e.keyCode === key_bindings.slower) {
        input_speed.stepUp();
        set_speed();
    }

    if (keys_down[e.keyCode]) {
        return;
    }

    if (e.keyCode === key_bindings.mode_wire) {
        mode_wire.checked = true;
    }
    if (e.keyCode === key_bindings.mode_protect) {
        mode_protect.checked = true;
    }
    if (e.keyCode === key_bindings.mode_wire_force) {
        mode_wire_force.checked = true;
    }
    if (e.keyCode === key_bindings.mode_goal) {
        mode_goal.checked = true;
    }

    keys_down[e.keyCode] = true;
    if (e.keyCode === key_bindings.pause) {
        if (running) {
            stop();
        } else {
            start();
        }
        e.preventDefault();
    }
    if (keys_down[key_bindings.guard]) {
        if (e.keyCode === key_bindings.reset) {
            reset();
            e.preventDefault();
        }
    }
    if (e.keyCode === key_bindings.flip_v) {
        clipboard_flip_v();
        e.preventDefault();
    } else if (e.keyCode === key_bindings.flip_h) {
        clipboard_flip_h();
        e.preventDefault();
    } else if (e.keyCode === key_bindings.rotate_cw) {
        clipboard_rotate_cw();
        e.preventDefault();
    } else if (e.keyCode === key_bindings.rotate_ccw) {
        clipboard_rotate_ccw();
        e.preventDefault();
    }
    if (e.keyCode === key_bindings.paste ||
        e.keyCode === key_bindings.additive_paste) {
        display_loop();
        e.preventDefault();
    }

    if (full_render == true) {
        render();
    }
}, false);

addEventListener("keyup", function (e) {
    delete keys_down[e.keyCode];
    if (e.keyCode === key_bindings.paste ||
        e.keyCode === key_bindings.additive_paste) {
        render();
        e.preventDefault();
    }
}, false);

addEventListener("click", function (e) {
    if (e.target == canvas && e.button === 0) {
        e.preventDefault();
    }
}, false);

addEventListener("mousedown", function (e) {
    if (e.target == canvas && e.button === 0) {
        var rect = canvas.getBoundingClientRect();
        mouse_start.x = parseInt((e.clientX - rect.left) / scale);
        mouse_start.y = parseInt((e.clientY - rect.top ) / scale);
        e.preventDefault();
    }
}, false);

addEventListener("mousemove", function (e) {
    if (e.target == canvas) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = parseInt((e.clientX - rect.left) / scale);
        mouse.y = parseInt((e.clientY - rect.top ) / scale);
        e.preventDefault();
    }
}, false);

addEventListener("mouseup", function (e) {
    if (e.target == canvas && e.button === 0) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = parseInt((e.clientX - rect.left) / scale);
        mouse.y = parseInt((e.clientY - rect.top ) / scale);
        if (mouse.x === mouse_start.x && mouse.y === mouse_start.y) {
            if (keys_down[key_bindings.paste]) {
                box_paste(mouse.x, mouse.y, false);
            } else if (keys_down[key_bindings.additive_paste]) {
                box_paste(mouse.x, mouse.y, true);
            } else {
                if (mode_wire.checked) {
                    toggle_cell(mouse.x, mouse.y, false);
                } else if (mode_protect.checked) {
                    toggle_protect(mouse.x, mouse.y);
                } else if (mode_wire_force.checked) {
                    toggle_cell(mouse.x, mouse.y, true);
                } else if (mode_goal.checked) {
                    toggle_goal(mouse.x, mouse.y);
                }
            }
        } else {
            if (keys_down[key_bindings.copy]) {
                box_copy(mouse_start.x, mouse_start.y, mouse.x, mouse.y);
            } else if (keys_down[key_bindings.cut]) {
                box_copy(mouse_start.x, mouse_start.y, mouse.x, mouse.y);
                box_erase(mouse_start.x, mouse_start.y, mouse.x, mouse.y);
            } else if (keys_down[key_bindings.erase]) {
                box_erase(mouse_start.x, mouse_start.y, mouse.x, mouse.y);
            } else {
                const set_to = !keys_down[key_bindings.subtract]
                if (mode_wire.checked) {
                    line_cell(mouse_start.x, mouse_start.y, mouse.x, mouse.y, set_to, false);
                } else if (mode_protect.checked) {
                    box_protect(mouse_start.x, mouse_start.y, mouse.x, mouse.y, set_to);
                } else if (mode_wire_force.checked) {
                    line_cell(mouse_start.x, mouse_start.y, mouse.x, mouse.y, set_to, true);
                } else if (mode_goal.checked) {
                    toggle_goal(mouse.x, mouse.y);
                }
            }
        }
        e.preventDefault();

        if (full_render == true) {
            render();
        }
    }
}, false);


function load_from_image() {
    const img = document.getElementById('loaded-img');
    const input_width = document.getElementById("input_width");
    const input_height = document.getElementById("input_height");
    input_width.value = img.width;
    input_height.value = img.height;
    set_size();
    goals = Array(0);

    ctx.drawImage(img, 0, 0, img.width, img.height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const data = ctx.getImageData(x, y, 1, 1).data;
            const signal = (data[2] << signal_shift) & Cell.Signal;
            if (data[2] === 255) { // Off, not goal
                circuit.set_cell(x,y, Cell.Wire);
            } else if (data[0] === 255 && data[1] >= 128) { // On, not goal
                circuit.set_cell(x,y, Cell.Wire | signal);
            } else if (data[0] >= 128 && data[1] === 0) { // Goal
                circuit.set_cell(x,y, Cell.Wire | signal | Cell.Goal);
                goals.push({x: x, y: y});
            } else { // Blank
                circuit.set_cell(x,y, 0);
            }
            if (data[1] === 255 || (data[0] <= 32 && data[2] <= 32 && data[1] === 128) || (data[0] >= 128 && data[1] === 0)) { // Protected cell
                circuit.add_to_cell(x,y, Cell.Protected);
            }
        }
    }
    it_acc = 0;
    executionStatus.innerHTML = "Loaded from image";
    full_render = true;
    render();
    full_update = true;
}

document.getElementById('loaded-img').onload = function () {
    load_from_image();
}


document.getElementById('img-loader').onchange = function (e) {
    const target = e.target || window.event.srcElement,
        files = target.files;

    if (FileReader && files && files.length) {
        var file_reader = new FileReader();
        file_reader.onload = function () {
            document.getElementById('loaded-img').src = file_reader.result;
        }
        file_reader.readAsDataURL(files[0]);
    }
}

window.start = start;
window.stop = stop;
window.reset = reset;
window.set_speed = set_speed;
window.set_size = set_size;
window.clear = clear;
window.load_from_image = load_from_image;
