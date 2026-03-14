file_path = "src/classifier.rs"
with open(file_path, "r") as f:
    content = f.read()

content = content.replace('''    fn is_provider(&self, provider: u32, customer: u32) -> bool {
        let db = self.provider_db.lock();
        if let Some(customers) = db.get(&provider) {
            if customers.contains(&customer) {
                return true;
            }
        }
        false
    }''', '''    fn is_provider(&self, provider: u32, customer: u32) -> bool {
        let db = self.provider_db.lock();
        if let Some(customers) = db.get(&provider)
            && customers.contains(&customer)
        {
            return true;
        }
        false
    }''')

with open(file_path, "w") as f:
    f.write(content)
