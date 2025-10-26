use arcis_imports::*;

#[encrypted]
mod circuits {
    use arcis_imports::*;

    pub const MAX_ORDERS: usize = 5;
    pub const MAX_MATCHES_PER_BATCH: usize = 2;

    #[derive(Copy, Clone)]
    pub struct Order {
        pub order_id: u64, // 8
        pub amount: u64, // 8
        pub price: u64, // 8
        pub order_type: u8, // 1
        pub timestamp: u64, // 8
    } 

    impl Order {
        pub fn empty() -> Self {
            Order {
                order_id: 0,
                amount: 0,
                price: 0,
                order_type: 0,
                timestamp: 0,
            }
        }

        pub fn is_buy(&self) -> bool {
            self.order_type == 0
        }

        pub fn is_sell(&self) -> bool {
            self.order_type == 1
        }
    }
    #[derive(Copy, Clone)]
    pub struct OrderBook {
        pub buy_orders: [Order; MAX_ORDERS],
        pub buy_count: u8,
        pub sell_orders: [Order; MAX_ORDERS],
        pub sell_count: u8,
    }

    impl OrderBook {
        pub fn new() -> Self {
            OrderBook {
                buy_orders: [Order::empty(); MAX_ORDERS],
                buy_count: 0,
                sell_orders: [Order::empty(); MAX_ORDERS],
                sell_count: 0,
            }
        }

        pub fn insert_buy(&mut self, order: Order) -> bool {
            let success = if self.buy_count >= MAX_ORDERS as u8 {
                false
            } else {
                self.buy_orders[self.buy_count as usize] = order;
                self.buy_count += 1;

                let mut i = self.buy_count - 1;
                let mut done = false;
                for _ in 0..MAX_ORDERS {
                    if i == 0 || done {
                        done = true;
                    } else {
                        let parent = (i - 1) / 2;
                        if self.compare_buy(i as usize, parent as usize) {
                            self.buy_orders.swap(i as usize, parent as usize);
                            i = parent;
                        } else {
                            done = true;
                        }
                    }
                }

                true
            };
            success
        }

        pub fn insert_sell(&mut self, order: Order) -> bool {
            let success = if self.sell_count >= MAX_ORDERS as u8 {
                false
            } else {
                self.sell_orders[self.sell_count as usize] = order;
                self.sell_count += 1;

                let mut i = self.sell_count - 1;
                let mut done = false;
                for _ in 0..MAX_ORDERS {
                    if i == 0 || done {
                        done = true;
                    } else {
                        let parent = (i - 1) / 2;
                        if self.compare_sell(i as usize, parent as usize) {
                            self.sell_orders.swap(i as usize, parent as usize);
                            i = parent;
                        } else {
                            done = true;
                        }
                    }
                }

                true
            };
            success
        }

        fn compare_buy(&self, i: usize, j: usize) -> bool {
            let a = &self.buy_orders[i];
            let b = &self.buy_orders[j];

            if a.price != b.price {
                a.price > b.price
            } else {
                a.timestamp < b.timestamp
            }
        }

        fn compare_sell(&self, i: usize, j: usize) -> bool {
            let a = &self.sell_orders[i];
            let b = &self.sell_orders[j];

            if a.price != b.price {
                a.price < b.price
            } else {
                a.timestamp < b.timestamp
            }
        }

        fn heapify_buy(&mut self, mut i: usize) {
            let mut done = false;
            for _ in 0..MAX_ORDERS {
                if done {
                    // continue
                } else {
                    let left = 2 * i + 1;
                    let right = 2 * i + 2;
                    let mut largest = i;

                    if left < self.buy_count as usize && self.compare_buy(left, largest) {
                        largest = left;
                    }

                    if right < self.buy_count as usize && self.compare_buy(right, largest) {
                        largest = right;
                    }

                    if largest != i {
                        self.buy_orders.swap(i, largest);
                        i = largest;
                    } else {
                        done = true;
                    }
                }
            }
        }

        fn heapify_sell(&mut self, mut i: usize) {
            let mut done = false;
            for _ in 0..MAX_ORDERS {
                if done {
                    // continue
                } else {
                    let left = 2 * i + 1;
                    let right = 2 * i + 2;
                    let mut smallest = i;

                    if left < self.sell_count as usize && self.compare_sell(left, smallest) {
                        smallest = left;
                    }

                    if right < self.sell_count as usize && self.compare_sell(right, smallest) {
                        smallest = right;
                    }

                    if smallest != i {
                        self.sell_orders.swap(i, smallest);
                        i = smallest;
                    } else {
                        done = true;
                    }
                }
            }
        }

        pub fn pop_buy(&mut self) -> Order {
            let order = self.buy_orders[0];
            self.buy_count -= 1;

            if self.buy_count > 0 {
                self.buy_orders[0] = self.buy_orders[self.buy_count as usize];
                self.heapify_buy(0);
            }

            order
        }

        pub fn pop_sell(&mut self) -> Order {
            let order = self.sell_orders[0];
            self.sell_count -= 1;

            if self.sell_count > 0 {
                self.sell_orders[0] = self.sell_orders[self.sell_count as usize];
                self.heapify_sell(0);
            }

            order
        }

        pub fn peek_buy(&self) -> Order {
            self.buy_orders[0]
        }

        pub fn peek_sell(&self) -> Order {
            self.sell_orders[0]
        }

        pub fn has_buy(&self) -> bool {
            self.buy_count > 0
        }

        pub fn has_sell(&self) -> bool {
            self.sell_count > 0
        }
    }

    #[derive(Copy, Clone)]
    pub struct MatchedOrder {
        pub match_id: u64,
        pub buyer_order_id: u64,
        pub seller_order_id: u64,
        pub quantity: u64,
        pub execution_price: u64,
    }

    impl MatchedOrder {
        pub fn empty() -> Self {
            MatchedOrder {
                match_id: 0,
                buyer_order_id: 0,
                seller_order_id: 0,
                quantity: 0,
                execution_price: 0,
            }
        }
    }

    pub struct MatchResult {
        pub matches: [MatchedOrder; MAX_MATCHES_PER_BATCH],
        pub num_matches: u8,
    }

    impl MatchResult {
        pub fn empty() -> Self {
            MatchResult {
                matches: [MatchedOrder::empty(); MAX_MATCHES_PER_BATCH],
                num_matches: 0,
            }
        }

        // Helper to set matches one at a time
        pub fn set_match(&mut self, index: u8, matched_order: MatchedOrder) {
            for i in 0..MAX_MATCHES_PER_BATCH {
                if i == index as usize {
                    self.matches[i] = matched_order;
                }
            }
        }
    }

    #[instruction]
    pub fn init_order_book(mxe: Mxe) -> Enc<Mxe, OrderBook> {
        let order_book = OrderBook::new();
        mxe.from_arcis(order_book)
    }
    pub struct SensitiveOrderData {
        pub amount: u64,
        pub price: u64,
    }

    #[instruction]
    pub fn submit_order(
        sensitive_ctxt: Enc<Shared, SensitiveOrderData>,
        orderbook_ctxt: Enc<Mxe, &OrderBook>,
        order_id: u64,
        order_type: u8,
        timestamp: u64,
    ) -> (Enc<Mxe, OrderBook>, bool, u8, u8) {
        let sensitive = sensitive_ctxt.to_arcis();
        let mut order_book = *(orderbook_ctxt.to_arcis());

        let order = Order {
            order_id,
            amount: sensitive.amount,
            price: sensitive.price,
            order_type,
            timestamp,
        };

        let success = if order.is_buy() {
            order_book.insert_buy(order)
        } else {
            order_book.insert_sell(order)
        };

        let buy_count = order_book.buy_count;
        let sell_count = order_book.sell_count;

        (
            orderbook_ctxt.owner.from_arcis(order_book), // Re-encrypt for MXE
            success.reveal(),
            buy_count.reveal(),
            sell_count.reveal(),
        )
    }

    #[instruction]
    pub fn match_orders(
        clanker_authority: Shared,
        order_book_ctxt: Enc<Mxe, &OrderBook>,
    ) -> (Enc<Shared, MatchResult>, Enc<Mxe, OrderBook>) {
        let mut order_book = *(order_book_ctxt.to_arcis());
        let mut result = MatchResult::empty();

        let mut match_count = 0u8;
        let mut next_match_id = 0u64;

        for match_idx in 0..MAX_MATCHES_PER_BATCH {
            if order_book.has_buy() && order_book.has_sell() {
                let buy = order_book.peek_buy();
                let sell = order_book.peek_sell();

                if buy.price >= sell.price {
                    let mut buyer = order_book.pop_buy();
                    let mut seller = order_book.pop_sell();

                    let execution_price = (buyer.price + seller.price) / 2;
                    let fill_quantity = if buyer.amount < seller.amount {
                        buyer.amount
                    } else {
                        seller.amount
                    };

                    result.set_match(
                        match_idx as u8,
                        MatchedOrder {
                            match_id: next_match_id,
                            buyer_order_id: buyer.order_id,
                            seller_order_id: seller.order_id,
                            quantity: fill_quantity,
                            execution_price,
                        },
                    );

                    buyer.amount = buyer.amount - fill_quantity;
                    seller.amount = seller.amount - fill_quantity;

                    if buyer.amount > 0 {
                        order_book.insert_buy(buyer);
                    }

                    if seller.amount > 0 {
                        order_book.insert_sell(seller);
                    }

                    match_count = match_idx as u8 + 1;
                    next_match_id += 1;
                }
            }
        }

        result.num_matches = match_count;

        (
            clanker_authority.from_arcis(result),
            order_book_ctxt.owner.from_arcis(order_book),
        )
    }
}
