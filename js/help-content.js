// Help text for the Help page and the downloadable PDF guide (help/chai-green-app-guide.pdf).
// Each section says which roles it is for. Edit here, then rebuild the PDF (see README).
// Roles: admin, manager, staff (warehouse), store_manager, store (shop tablet), inspector.

const ALL = ['admin', 'manager', 'staff', 'store_manager', 'store', 'inspector'];
const SHOP = ['store_manager', 'store'];
const WAREHOUSE = ['admin', 'manager', 'staff'];
const HEAD_OFFICE = ['admin', 'manager'];

export const HELP = [
  { title: 'Getting started', who: ALL, topics: [
    { q: 'Signing in', steps: [
      'Open chai-green-stock.vercel.app on a phone, tablet or computer.',
      'Type your email and password, then press Sign in.',
      'Forgotten your password? Press "Forgotten password?" on the sign-in page and follow the email.'] },
    { q: 'New account', steps: [
      'On the sign-in page press "New staff member" and fill in your name, email and a password.',
      'Your account then waits for a manager to switch it on. Ask your manager to open Users and press Switch on.'] },
    { q: 'Finding your way around', steps: [
      'The menu is on the left. On a phone, press ☰ at the top to open it.',
      'On a phone, the bar at the bottom has shortcuts to the pages you use most.',
      'Press Sign out at the top right when you finish on a shared device.'] },
    { q: 'Put the app on your home screen', steps: [
      'iPhone: open the app in Safari, press the Share button, then "Add to Home Screen".',
      'Android: open the app in Chrome, press ⋮, then "Add to Home screen".'] }
  ] },

  { title: 'Daily and monthly safety checks', who: [...SHOP, ...HEAD_OFFICE], topics: [
    { q: 'Doing a check', steps: [
      'Open Today\'s checks. It shows each check (for example opening, midday and closing) and which are done.',
      'Press Start on the check you are doing.',
      'Choose your name and type your 4-digit PIN.',
      'Answer each question as you actually do it, one at a time. Answers given too quickly are flagged to head office as rushed.',
      'After the last question the check is signed with your name and saved in Safety records.'] },
    { q: 'Something is wrong (for example a fridge too warm)', steps: [
      'Answer truthfully. The app then asks what you did about it.',
      'Tap the action you took, or type it in the box. You can add a photo.',
      'Press Save what I did, and tell your manager straight away.'] }
  ] },

  { title: 'Ordering stock from the warehouse', who: SHOP, topics: [
    { q: 'Placing an order', steps: [
      'Open Order stock and press + New order.',
      'Search, or pick a category, and use + and − to set how many you need.',
      'Press Review order and check it.',
      'Add your name, the date you need it by and any notes, then press Send order to the warehouse.'] },
    { q: 'Following an order', steps: [
      'Order stock lists your orders: New, Being packed or Sent.',
      'You can cancel an order while it is still New. Once it is being packed, call the warehouse to change it.'] },
    { q: 'Prices (franchise managers only)', steps: [
      'Franchise store managers see the price Chai Green charges their store on each item, and the total with VAT in the basket.',
      'Shop staff logins and company-owned stores do not see prices.'] }
  ] },

  { title: 'Records, recipes and the manual', who: [...SHOP, 'inspector'], topics: [
    { q: 'Safety records', steps: [
      'Open Safety records to see every check done in your store, who signed it and the score.',
      'Open a record to see it in full. Press Print to print it or save it as a PDF.'] },
    { q: 'Recipes and allergens', steps: [
      'Open Recipes & allergens to see how each dish is made and the allergen chart.',
      'Always check the allergen chart before answering a customer\'s allergy question.'] },
    { q: 'Operations manual', steps: [
      'Open Operations manual and choose a page from the list. Press Print if you need a paper copy.'] }
  ] },

  { title: 'Store managers', who: ['store_manager'], topics: [
    { q: 'Your store team', steps: [
      'Open Store team to add each member of staff and give them a 4-digit PIN.',
      'Staff use their PIN to sign the safety checks on the shop tablet.',
      'Remove people who leave so they can no longer sign checks.'] },
    { q: 'My invoices (franchise stores)', steps: [
      'Open My invoices to see every invoice from Chai Green, what is still to pay and what is overdue.',
      'Open an invoice to see the lines and VAT, or press Print / save PDF.'] }
  ] },

  { title: 'Marketing', who: [...SHOP, ...HEAD_OFFICE], topics: [
    { q: 'Campaigns and promotions', steps: [
      'Open Marketing to see upcoming campaigns and promotions from head office.',
      'A number on the menu shows new campaigns since you last looked.'] },
    { q: 'Asking for marketing help', steps: [
      'Open Marketing, then Make a request.',
      'Fill in your name, phone, email, when you need it, what it is for, the aim and any notes, then send it.',
      'Your own email may open with the request filled in. Press Send in your email to finish.'] },
    { q: 'Approved images', steps: [
      'Open Marketing, then Images, to download photos and artwork approved for use.'] }
  ] },

  { title: 'Warehouse: stock in and out', who: WAREHOUSE, topics: [
    { q: 'Goods in (a delivery arrives)', steps: [
      'Open Goods in and choose the supplier (and the purchase order, if there is one).',
      'Scan or search each product, then enter the quantity and the use-by date.',
      'Take a photo of the delivery note, then save. Stock goes up straight away.'] },
    { q: 'Shop orders', steps: [
      'New orders from the shops show on Shop orders with a number on the menu.',
      'Open an order and press Start packing so the shop knows it is being packed.',
      'When it is packed, press Book out with Stock out. The order lines fill in for you.'] },
    { q: 'Stock out (sending stock to a store)', steps: [
      'Open Stock out and choose the store.',
      'Scan or search each product and enter the quantity.',
      'Add who collected it and a photo if asked, then book it out.',
      'The invoice is made automatically, and stock goes down.'] },
    { q: 'Stock check and full stock take', steps: [
      'Stock check: each week the app picks a group of products to count. Count them and enter what you find.',
      'Full stock take: count everything, for example at the end of the month.',
      'Any difference is recorded in Stock history.'] },
    { q: 'Write-off / adjust', steps: [
      'Use Write-off / adjust for anything damaged, out of date, lost or found.',
      'Choose the product, the amount and the reason, then save.'] },
    { q: 'Products, reorder and purchase orders', steps: [
      'Products & stock shows every product, how many are in stock and the next use-by date.',
      'Reorder shows what is running low and how much to order.',
      'Purchase orders lists orders to suppliers. Receive them through Goods in when they arrive.'] }
  ] },

  { title: 'Head office', who: HEAD_OFFICE, topics: [
    { q: 'Invoices and collections', steps: [
      'Invoices lists every invoice. Open one to print it, email it to the store, or mark it paid.',
      'Press Export for accounts (CSV) to download invoices for your accounts package.',
      'Collections lists every stock-out, with its delivery note.'] },
    { q: 'Stores and safety', steps: [
      'All stores overview shows every store\'s checks today, including any marked as rushed.',
      'Checklists lets you change the questions in each check.',
      'Store teams lets you add or remove staff and PINs for any store.',
      'Operations manual: press + New page or Edit page to update it.'] },
    { q: 'Marketing', steps: [
      'Add campaigns and promotions for the stores, see their marketing requests, and upload approved images.'] },
    { q: 'Settings and users', steps: [
      'Settings holds the company details, invoice settings and marketing email.',
      'Users (admin only): switch on new accounts, and set each person\'s role and store.'] }
  ] },

  { title: 'Inspectors (Environmental Health)', who: ['inspector'], topics: [
    { q: 'What you can see', steps: [
      'You have read-only access to this store\'s food safety records, recipes and allergen chart.',
      'Open any record to see who signed it and when. Press Print to print it or save it as a PDF.'] }
  ] },

  { title: 'Need more help?', who: ALL, topics: [
    { q: 'Contact', steps: [
      'Speak to your store manager first.',
      'For anything else, contact Chai Green head office.'] }
  ] }
];

export const ROLE_NAMES = { admin: 'Head office (admin)', manager: 'Head office', staff: 'Warehouse', store_manager: 'Store manager', store: 'Shop staff', inspector: 'Inspector' };
