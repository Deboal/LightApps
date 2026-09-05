//! Several machines wired together by a link cable.
//!
//! This is the netplay substrate, and it is deliberately not networked. Each
//! participant emulates *every* machine and feeds each one its own player's
//! buttons; the cable traffic is then generated locally, synchronously, by
//! emulated hardware that both sides compute identically. A network, when
//! there is one, only has to carry button presses — which is far more
//! forgiving of latency than forwarding link bytes would be.
//!
//! That only works because the core is deterministic. It is the reason
//! decision 1.2 exists.

use crate::link::{self, Phase};
use crate::{Emulator, KeyState, CYCLES_PER_FRAME};

/// How far each machine runs before the cable is serviced. Small enough that
/// the machines cannot drift meaningfully apart within one transfer, large
/// enough that the bookkeeping is not the dominant cost.
const QUANTUM: u64 = 256;

pub struct Cable {
    pub machines: Vec<Emulator>,
    /// The shared clock the quanta are measured against. Every machine tracks
    /// its own cycles; this is the fixed grid they are stepped along, so the
    /// interleaving does not depend on how long any instruction happened to
    /// take.
    cycles: u64,
    /// How many transfers the cable has carried. Diagnostic only: a link that
    /// stalls and a link that carries wrong data look identical from the
    /// screen, and this tells them apart.
    pub transfers: u64,
    /// Cycle stamps of every transfer start, when asked for. Diagnostic only:
    /// the game paces transfers with a timer and demands nine per frame, so
    /// the interesting quantity is where in the frame each one lands.
    pub transfer_log: Option<Vec<u64>>,
}

impl Cable {
    /// Wire up two to four machines. Machine 0 becomes the parent.
    pub fn new(mut machines: Vec<Emulator>) -> Cable {
        let players = machines.len().min(4) as u8;
        for (index, machine) in machines.iter_mut().enumerate() {
            machine.mem.link.id = index as u8;
            machine.mem.link.players = players;
        }
        Cable {
            machines,
            cycles: 0,
            transfers: 0,
            transfer_log: None,
        }
    }

    pub fn players(&self) -> usize {
        self.machines.len()
    }

    /// Run one frame on every machine, sampling each player's input once at
    /// the frame boundary.
    pub fn run_frame(&mut self, inputs: &[KeyState]) {
        for (index, machine) in self.machines.iter_mut().enumerate() {
            let keys = inputs.get(index).copied().unwrap_or_default();
            machine.set_input(keys);
        }

        let end = self.cycles + CYCLES_PER_FRAME;
        while self.cycles < end {
            let next = (self.cycles + QUANTUM).min(end);
            for machine in self.machines.iter_mut() {
                while machine.mem.cycles < next {
                    machine.step();
                }
            }
            self.service();
            self.cycles = next;
        }
    }

    /// Move one transfer's worth of words around the cable, then let each
    /// machine finish any transfer whose time has elapsed.
    fn service(&mut self) {
        let requested = self
            .machines
            .iter()
            .position(|m| m.mem.link.phase == Phase::Requested);

        if let Some(parent) = requested {
            // A slot with no machine on it reads as an absent unit, which is
            // how a game tells two players from four.
            let mut words = [link::DISCONNECTED; 4];
            for (slot, machine) in self.machines.iter().enumerate().take(4) {
                words[slot] = machine.mem.link_outgoing();
            }
            let duration = link::transfer_cycles(self.machines[parent].mem.siocnt());
            self.transfers += 1;
            if let Some(log) = self.transfer_log.as_mut() {
                log.push(self.cycles);
            }
            for machine in self.machines.iter_mut() {
                machine.mem.link_deliver(words, duration);
            }
        }

        for machine in self.machines.iter_mut() {
            machine.mem.link_tick();
        }
    }

    /// A hash of every machine's state, for spotting a desync.
    ///
    /// Two participants running the same inputs must agree on this. When they
    /// stop agreeing the session is already wrong, and stopping loudly beats
    /// letting one side write a corrupted save.
    pub fn state_hash(&self) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325u64;
        for machine in &self.machines {
            for byte in machine.serialize_state() {
                hash ^= byte as u64;
                hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        hash
    }
}
