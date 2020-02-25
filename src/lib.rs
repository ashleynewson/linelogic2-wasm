use wasm_bindgen::prelude::*;


extern crate console_error_panic_hook;
use std::panic;

#[macro_use]
extern crate bitflags;


#[wasm_bindgen(start)]
pub fn main() -> Result<(), JsValue> {
    panic::set_hook(Box::new(console_error_panic_hook::hook));
    Ok(())
}


// This is arguably enum abuse.
#[wasm_bindgen]
#[repr(u8)]
pub enum CellBits {
    Wire      = 0b00000001,
    Protected = 0b00000010,
    Goal      = 0b00000100,

    Queued    = 0b00001000,

    Right     = 0b00010000,
    Down      = 0b00100000,
    Left      = 0b01000000,
    Up        = 0b10000000,

    Design    = 0b00000111,
    Signal    = 0b11110000,
    Material  = 0b11110001,

    Horizontal = 0b00110000,
    Vertical   = 0b11000000,
}

bitflags! {
    pub struct Cell: u8 {
        const WIRE      = 0b00000001;
        const PROTECTED = 0b00000010;
        const GOAL      = 0b00000100;

        const QUEUED    = 0b00001000;

        const RIGHT     = 0b00010000;
        const DOWN      = 0b00100000;
        const LEFT      = 0b01000000;
        const UP        = 0b10000000;

        const DESIGN    = 0b00000111;
        const SIGNAL    = 0b11110000;
        const MATERIAL  = 0b11110001;

        const HORIZONTAL = 0b00110000;
        const VERTICAL   = 0b11000000;
    }
}

struct Coord {
    x: usize,
    y: usize,
}



#[wasm_bindgen]
pub struct Circuit {
    width: usize,
    height: usize,
    full_update: bool,
    cells: Vec<Cell>,
    next_cells: Vec<Cell>,
    update_queue: Option<Vec<Coord>>,
    next_update_queue: Vec<Coord>,
}

#[wasm_bindgen]
impl Circuit {
    pub fn new(width: usize, height: usize) -> Self {
        if width == 0 || height == 0 {
            panic!("Width and height must be > 0");
        }
        width.checked_mul(height).expect("width * height overflows");
        Self {
            width,
            height,
            full_update: true,
            cells: vec![Cell::empty(); width * height],
            next_cells: vec![Cell::empty(); width * height],
            update_queue: Some(Vec::new()),
            next_update_queue: Vec::new(),
        }
    }

    pub fn resize(&mut self, new_width: usize, new_height: usize) {
        if new_width == 0 || new_height == 0 {
            panic!("Width and height must be > 0");
        }
        let mut new_cells = vec![Cell::empty(); new_width * new_height];

        let copy_width  = std::cmp::min(self.width , new_width );
        let copy_height = std::cmp::min(self.height, new_height);
        for y in 1..copy_height-1 { // leave a border
            for x in 1..copy_width-1 {
                new_cells[y * new_width + x] = self.cells[y * self.width + x];
            }
        }

        self.width = new_width;
        self.height = new_height;
        self.full_update = true;
        self.cells = new_cells;
        self.next_cells = self.cells.clone();
        self.update_queue = Some(Vec::new());
        self.next_update_queue = Vec::new();
    }

    pub fn get_width(&self) -> usize {
        self.width
    }
    pub fn get_height(&self) -> usize {
        self.height
    }

    // Restrictions:
    //   Pointer should be re-obtained after any mutable call.
    pub fn cells_ptr(&self) -> *const Cell {
        self.cells.as_ptr()
    }
    // Restrictions:
    //   Pointer should be re-obtained after any (other) mutable call.
    pub fn cells_mut_ptr(&mut self) -> *mut Cell {
        self.cells.as_mut_ptr()
    }

    pub fn index(&self, x: usize, y: usize) -> usize {
        if x >= self.width || y >= self.height {
            panic!("Cell ({}, {}) is out of bounds. Circuit size is {} by {}", x, y, self.width, self.height);
        }
        self.index_unchecked(x, y)
    }
    pub fn strict_index(&self, x: usize, y: usize) -> Option<usize> {
        if x == 0 || y == 0 || x >= self.width-1 || y >= self.height-1 {
            None
        } else {
            Some(self.index_unchecked(x, y))
        }
    }

    fn index_unchecked(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    pub fn get_cell(&self, x: usize, y: usize) -> u8 {
        self.cells[self.index(x, y)].bits()
    }
    pub fn set_cell(&mut self, x: usize, y: usize, value: u8) {
        if let Some(index) = self.strict_index(x, y) {
            self.cells[index]      = Cell::from_bits(value).expect("Invalid cell flags");
            self.next_cells[index] = self.cells[index];
            self.full_update = true;
        }
    }

    pub fn add_to_cell(&mut self, x: usize, y: usize, flags: u8) {
        if let Some(index) = self.strict_index(x, y) {
            self.cells[index].insert(Cell::from_bits(flags).expect("Invalid cell flags"));
            self.next_cells[index] = self.cells[index];
            self.full_update = true;
        }
    }
    pub fn sub_from_cell(&mut self, x: usize, y: usize, flags: u8) {
        if let Some(index) = self.strict_index(x, y) {
            self.cells[index].remove(Cell::from_bits(flags).expect("Invalid cell flags"));
            self.next_cells[index] = self.cells[index];
            self.full_update = true;
        }
    }
    pub fn toggle_in_cell(&mut self, x: usize, y: usize, flags: u8) {
        if let Some(index) = self.strict_index(x, y) {
            self.cells[index].toggle(Cell::from_bits(flags).expect("Invalid cell flags"));
            self.next_cells[index] = self.cells[index];
            self.full_update = true;
        }
    }
    pub fn set_in_cell(&mut self, x: usize, y: usize, flags: u8, value: bool) {
        if let Some(index) = self.strict_index(x, y) {
            self.cells[index].set(Cell::from_bits(flags).expect("Invalid cell flags"), value);
            self.next_cells[index] = self.cells[index];
            self.full_update = true;
        }
    }

    fn queue_update(&mut self, x: usize, y: usize) {
        if let Some(index) = self.strict_index(x, y) {
            if self.next_cells[index].contains(Cell::WIRE) && !self.next_cells[index].contains(Cell::QUEUED) {
                self.next_cells[index].insert(Cell::QUEUED);
                self.next_update_queue.push(Coord{x, y});
            }
        }
    }

    fn update_cell(&mut self, x: usize, y: usize) {
        debug_assert!(x > 0);
        debug_assert!(y > 0);
        debug_assert!(x < self.width  - 1);
        debug_assert!(y < self.height - 1);
        let index = self.index(x, y);

        self.cells[index].remove(Cell::QUEUED);
        let center = self.cells[index];

        if center.intersects(Cell::WIRE) {
            let width = self.width;

            let mut next_center = (self.cells[index] & Cell::DESIGN) | (self.next_cells[index] & Cell::QUEUED);

            let left  = self.cells[index - 1];
            let right = self.cells[index + 1];
            let up    = self.cells[index - width];
            let down  = self.cells[index + width];

            // Receive signals from neighbours
            if left.intersects(Cell::RIGHT) {
                next_center.insert(Cell::RIGHT);
            }
            if right.intersects(Cell::LEFT) {
                next_center.insert(Cell::LEFT);
            }
            if up.intersects(Cell::DOWN) {
                next_center.insert(Cell::DOWN);
            }
            if down.intersects(Cell::UP) {
                next_center.insert(Cell::UP);
            }

            // Split-invert/turn signals if appropriate.
            // Read the !=s here as boolean XOR.
            if !left.intersects(Cell::WIRE) && right.intersects(Cell::WIRE) {
                if    up.intersects(Cell::WIRE) && (center.intersects(Cell::LEFT ) !=  down.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::UP);
                }
                if  down.intersects(Cell::WIRE) && (center.intersects(Cell::LEFT ) !=    up.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::DOWN);
                }
            }
            if !right.intersects(Cell::WIRE) && left.intersects(Cell::WIRE) {
                if    up.intersects(Cell::WIRE) && (center.intersects(Cell::RIGHT) !=  down.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::UP);
                }
                if  down.intersects(Cell::WIRE) && (center.intersects(Cell::RIGHT) !=    up.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::DOWN);
                }
            }
            if !up.intersects(Cell::WIRE) && down.intersects(Cell::WIRE) {
                if  left.intersects(Cell::WIRE) && (center.intersects(Cell::UP   ) != right.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::LEFT);
                }
                if right.intersects(Cell::WIRE) && (center.intersects(Cell::UP   ) !=  left.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::RIGHT);
                }
            }
            if !down.intersects(Cell::WIRE) && up.intersects(Cell::WIRE) {
                if  left.intersects(Cell::WIRE) && (center.intersects(Cell::DOWN ) != right.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::LEFT);
                }
                if right.intersects(Cell::WIRE) && (center.intersects(Cell::DOWN ) !=  left.intersects(Cell::WIRE)) {
                    next_center.insert(Cell::RIGHT);
                }
            }
            self.next_cells[index] = next_center;

            let changes = center ^ next_center;
            if changes.intersects(Cell::SIGNAL) {
                // I suspect the ordering here may have at least some
                // effect on performance. I have order them based on
                // index position.
                if changes.intersects(Cell::UP) {
                    self.queue_update(x  , y-1);
                }
                if changes.intersects(Cell::LEFT) {
                    self.queue_update(x-1, y  );
                }
                // Needed due to how bends work
                self.queue_update(x  , y  );
                if changes.intersects(Cell::RIGHT) {
                    self.queue_update(x+1, y  );
                }
                if changes.intersects(Cell::DOWN) {
                    self.queue_update(x  , y+1);
                }
            }
        }        
    }

    pub fn tick(&mut self) {
        assert!(self.update_queue.is_some());

        self.next_update_queue.clear();

        if self.full_update {
            for next_cell in &mut self.next_cells {
                next_cell.remove(Cell::QUEUED);
            }
            for y in 1..(self.height-1) {
                for x in 1..(self.width-1) {
                    self.update_cell(x, y);
                }
            }
            self.full_update = false;
        } else {
            // Take the update queue out of self so that it doesn't
            // require us to have a reference to self (which we pass
            // on as mutable to update_cell)..
            let update_queue = self.update_queue.take().unwrap();
            for coord in &update_queue {
                self.update_cell(coord.x, coord.y);
            }
            assert!(self.update_queue.is_none());
            self.update_queue = Some(update_queue);
        }

        std::mem::swap(&mut self.cells, &mut self.next_cells);
        std::mem::swap(self.update_queue.as_mut().unwrap(), &mut self.next_update_queue);
    }

    pub fn force_full_update(&mut self) {
        self.full_update = true;
    }
}
