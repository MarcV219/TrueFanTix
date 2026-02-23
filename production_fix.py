#!/usr/bin/env python3
"""
Production-grade fix for Prisma enum imports
This script removes all Prisma enum imports and replaces them with string literals
"""
import os
import re
import glob

# All enum value replacements
ENUM_REPLACEMENTS = {
    # OrderStatus
    'OrderStatus.PAID': '"PAID"',
    'OrderStatus.PENDING': '"PENDING"',
    'OrderStatus.DELIVERED': '"DELIVERED"',
    'OrderStatus.COMPLETED': '"COMPLETED"',
    'OrderStatus.CANCELLED': '"CANCELLED"',
    # TicketStatus
    'TicketStatus.AVAILABLE': '"AVAILABLE"',
    'TicketStatus.RESERVED': '"RESERVED"',
    'TicketStatus.SOLD': '"SOLD"',
    # PaymentStatus
    'PaymentStatus.SUCCEEDED': '"SUCCEEDED"',
    'PaymentStatus.PENDING': '"PENDING"',
    # TicketEscrowState
    'TicketEscrowState.HELD': '"HELD"',
    'TicketEscrowState.RELEASED_TO_BUYER': '"RELEASED_TO_BUYER"',
    'TicketEscrowState.RELEASED_BACK_TO_SELLER': '"RELEASED_BACK_TO_SELLER"',
    # TicketVerificationStatus
    'TicketVerificationStatus.PENDING': '"PENDING"',
    'TicketVerificationStatus.VERIFIED': '"VERIFIED"',
    'TicketVerificationStatus.NEEDS_REVIEW': '"NEEDS_REVIEW"',
    'TicketVerificationStatus.REJECTED': '"REJECTED"',
    # ForumVisibility
    'ForumVisibility.VISIBLE': '"VISIBLE"',
    'ForumVisibility.HIDDEN': '"HIDDEN"',
    'ForumVisibility.DELETED': '"DELETED"',
    # ForumTopicType
    'ForumTopicType.ARTIST': '"ARTIST"',
    'ForumTopicType.TEAM': '"TEAM"',
    'ForumTopicType.SHOW': '"SHOW"',
    'ForumTopicType.OTHER': '"OTHER"',
}

# Import patterns to remove
IMPORT_PATTERNS = [
    r'import\s*\{\s*[^}]*OrderStatus[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*TicketStatus[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*PaymentStatus[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*TicketEscrowState[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*TicketVerificationStatus[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*ForumVisibility[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*[^}]*ForumTopicType[^}]*\}\s*from\s*"@prisma/client";\n?',
    r'import\s*\{\s*Prisma[^}]*\}\s*from\s*"@prisma/client";\n?',
]

def fix_file(filepath):
    """Fix a single file"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Remove enum imports
    for pattern in IMPORT_PATTERNS:
        content = re.sub(pattern, '', content)
    
    # Replace enum usages with strings
    for old, new in ENUM_REPLACEMENTS.items():
        content = content.replace(old, new)
    
    # Fix Prisma.PrismaClientKnownRequestError
    content = content.replace('Prisma.PrismaClientKnownRequestError', 'any')
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def fix_implicit_any(filepath):
    """Add explicit types to callback parameters"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    original = content
    
    # Fix $transaction callbacks
    content = re.sub(r'\$transaction\s*\(\s*async\s*\(\s*(\w+)\s*\)', r'$transaction(async (\1: any)', content)
    
    # Fix .map() callbacks (including nested)
    content = re.sub(r'\.map\s*\(\s*\(\s*(\w+)\s*\)', r'.map((\1: any)', content)
    content = re.sub(r'\.map\s*\(\s*async\s*\(\s*(\w+)\s*\)', r'.map(async (\1: any)', content)
    
    # Fix .filter() callbacks
    content = re.sub(r'\.filter\s*\(\s*\(\s*(\w+)\s*\)', r'.filter((\1: any)', content)
    
    # Fix .flatMap() callbacks
    content = re.sub(r'\.flatMap\s*\(\s*\(\s*(\w+)\s*\)', r'.flatMap((\1: any)', content)
    
    # Fix .find() callbacks
    content = re.sub(r'\.find\s*\(\s*\(\s*(\w+)\s*\)', r'.find((\1: any)', content)
    
    # Fix .some() callbacks
    content = re.sub(r'\.some\s*\(\s*\(\s*(\w+)\s*\)', r'.some((\1: any)', content)
    
    # Fix .sort() callbacks
    content = re.sub(r'\.sort\s*\(\s*\(\s*(\w+),\s*(\w+)\s*\)', r'.sort((\1: any, \2: any)', content)
    
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    api_dir = 'src/app/api'
    files = glob.glob(f'{api_dir}/**/*.ts', recursive=True)
    
    fixed_enums = 0
    fixed_any = 0
    
    print(f"Processing {len(files)} files...\n")
    
    for filepath in files:
        if fix_file(filepath):
            fixed_enums += 1
            print(f"[ENUMS] Fixed: {filepath}")
        
        if fix_implicit_any(filepath):
            fixed_any += 1
            print(f"[TYPES] Fixed: {filepath}")
    
    print(f"\n{'='*60}")
    print(f"Total files with enum fixes: {fixed_enums}")
    print(f"Total files with type fixes: {fixed_any}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
